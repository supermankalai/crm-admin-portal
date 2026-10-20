import "server-only";
import { formatDateTime, localDate, toDateString } from "@/domain/dates";
import { dedupeKey, waitlistPromotedText } from "@/domain/notifications";
import { assertBookable, bookingPlacement, canMarkAttendance, ClassRuleError, membershipForBooking, refundsCredit, type BookableMembership } from "@/domain/classes";
import { recordAudit, recordMemberAudit, type AuditEvent } from "@/server/audit/tenant-audit";
import type { Tx } from "@/server/db/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { assertFeature } from "@/server/plan/limits";
import type { RequestMeta } from "@/server/security/request-meta";
import { inAppChannel } from "@/server/notifications";
import { inTenant } from "@/server/tenant/guards";
import { inMemberAction, type MemberContext } from "@/server/tenant/member";
import type { TenantContext } from "@/server/tenant/types";
import { visibilityWhere } from "../members/shared";
import { lockClassSession } from "./lock";
import { assertCanManageSession, rule } from "./sessions";

/**
 * Bookings. Every change takes the class session's lock first, so capacity checks and waitlist
 * positions are decided one booking at a time: no overbooking even when many people — staff at
 * the desk and members in the app — try to take the last spot at once.
 *
 * The same code serves staff and members through a BookingActor: it says which database context
 * to run in and how to audit. Members run in a member-action context (see app_is_member_action()).
 */

export type BookingActor = {
  gymId: string;
  timezone: string;
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  audit(tx: Tx, event: AuditEvent, meta: RequestMeta): Promise<void>;
};

export function staffActor(ctx: TenantContext): BookingActor {
  return { gymId: ctx.gym.id, timezone: ctx.gym.timezone, run: (fn) => inTenant(ctx, fn), audit: (tx, e, m) => recordAudit(tx, ctx, e, m) };
}

export function memberActor(ctx: MemberContext): BookingActor {
  return { gymId: ctx.gym.id, timezone: ctx.gym.timezone, run: (fn) => inMemberAction(ctx, fn), audit: (tx, e, m) => recordMemberAudit(tx, ctx, e, m) };
}

async function bookableMemberships(tx: Tx, memberId: string): Promise<BookableMembership[]> {
  const rows = await tx.membership.findMany({
    where: { memberId },
    select: { id: true, status: true, startDate: true, endDate: true, cancelledAt: true, classCreditsRemaining: true, freezes: { select: { startDate: true, endDate: true } } },
  });
  return rows.map((m) => ({
    ...m,
    startDate: toDateString(m.startDate),
    endDate: toDateString(m.endDate),
    freezes: m.freezes.map((f) => ({ startDate: toDateString(f.startDate), endDate: toDateString(f.endDate) })),
  }));
}

/** Spend one class-pack credit; the WHERE guard means it can never go below zero. */
async function spendCredit(tx: Tx, membershipId: string) {
  const updated = await tx.membership.updateMany({ where: { id: membershipId, classCreditsRemaining: { gt: 0 } }, data: { classCreditsRemaining: { decrement: 1 } } });
  if (updated.count !== 1) throw new ValidationError("The class pack has no classes left.");
}

async function returnCredit(tx: Tx, membershipId: string) {
  await tx.membership.update({ where: { id: membershipId }, data: { classCreditsRemaining: { increment: 1 } }, select: { id: true } });
}

function assertCanBook(ctx: TenantContext) {
  if (!ctx.permissions.has("classes.book") && !ctx.permissions.has("classes.manage")) throw new ForbiddenError("You can't book classes for members.");
  assertFeature(ctx, "classBookings");
}

/** Renumber the waitlist 1..n in its current order. */
async function renumberWaitlist(tx: Tx, sessionId: string) {
  const waiting = await tx.booking.findMany({ where: { sessionId, status: "WAITLISTED" }, orderBy: [{ waitlistPosition: "asc" }, { bookedAt: "asc" }], select: { id: true, waitlistPosition: true } });
  for (const [i, b] of waiting.entries()) {
    if (b.waitlistPosition !== i + 1) await tx.booking.update({ where: { id: b.id }, data: { waitlistPosition: i + 1 }, select: { id: true } });
  }
}

/**
 * Move people from the waitlist into free spots, in queue order. Someone who is no longer
 * eligible (membership ended, no credits) is skipped and stays on the list. Call with the
 * session lock held.
 */
export async function promoteFromWaitlist(tx: Tx, actor: BookingActor, sessionId: string, freeSpots: number, meta: RequestMeta) {
  if (freeSpots <= 0) return 0;
  const session = await tx.classSession.findUniqueOrThrow({ where: { id: sessionId }, select: { startsAt: true, status: true } });
  if (session.status !== "SCHEDULED" || session.startsAt <= new Date()) return 0;
  const classDate = localDate(session.startsAt, actor.timezone);
  const waiting = await tx.booking.findMany({ where: { sessionId, status: "WAITLISTED" }, orderBy: { waitlistPosition: "asc" }, select: { id: true, memberId: true } });
  let promoted = 0;
  for (const b of waiting) {
    if (promoted >= freeSpots) break;
    let choice: { membershipId: string; usesCredit: boolean };
    try {
      choice = membershipForBooking(await bookableMemberships(tx, b.memberId), classDate);
    } catch (error) {
      if (error instanceof ClassRuleError) continue;
      throw error;
    }
    if (choice.usesCredit) await spendCredit(tx, choice.membershipId);
    await tx.booking.update({
      where: { id: b.id },
      data: { status: "BOOKED", waitlistPosition: null, creditMembershipId: choice.usesCredit ? choice.membershipId : null },
      select: { id: true },
    });
    await actor.audit(tx, { action: "booking.promote", entityType: "Booking", entityId: b.id, changes: { sessionId } }, meta);
    await notifyPromoted(tx, actor, b.id, b.memberId, session.startsAt, sessionId);
    promoted++;
  }
  if (promoted) await renumberWaitlist(tx, sessionId);
  return promoted;
}

/** Tell a promoted member (if they use the member app) that they're in. */
async function notifyPromoted(tx: Tx, actor: BookingActor, bookingId: string, memberId: string, startsAt: Date, sessionId: string) {
  const [row] = await tx.$queryRaw<{ user_id: string | null }[]>`SELECT member_app_user_id(${memberId}) AS user_id`;
  if (!row?.user_id) return;
  const cls = await tx.classSession.findUnique({ where: { id: sessionId }, select: { classType: { select: { name: true } } } });
  const text = waitlistPromotedText(cls?.classType.name ?? "your class", formatDateTime(startsAt, actor.timezone));
  await inAppChannel.send(tx, [
    { gymId: actor.gymId, recipientUserId: row.user_id, type: "WAITLIST_PROMOTED", ...text, entityType: "Booking", entityId: bookingId, dedupeKey: dedupeKey("WAITLIST_PROMOTED", bookingId, row.user_id) },
  ]);
}

type SessionRow = Awaited<ReturnType<typeof lockClassSession>>;

/** Book (or waitlist) one member into a locked session. Shared by staff and member paths. */
async function placeBooking(tx: Tx, actor: BookingActor, session: SessionRow, memberId: string, meta: RequestMeta) {
  rule(() => assertBookable(session));
  const existing = await tx.booking.findUnique({ where: { sessionId_memberId: { sessionId: session.id, memberId } } });
  if (existing && existing.status !== "CANCELLED") {
    throw new ValidationError(existing.status === "WAITLISTED" ? `Already on the waitlist (position ${existing.waitlistPosition}).` : "Already booked into this class.");
  }

  const memberships = await bookableMemberships(tx, memberId);
  const choice = rule(() => membershipForBooking(memberships, localDate(session.startsAt, actor.timezone)));

  const booked = await tx.booking.count({ where: { sessionId: session.id, status: { in: ["BOOKED", "ATTENDED"] } } });
  const waitlisted = await tx.booking.count({ where: { sessionId: session.id, status: "WAITLISTED" } });
  const placement = bookingPlacement(session.capacity, booked, waitlisted);
  // Credits are spent only when a spot is confirmed (now, or later on promotion).
  const usesCredit = placement.status === "BOOKED" && choice.usesCredit;
  if (usesCredit) await spendCredit(tx, choice.membershipId);

  const data = {
    status: placement.status,
    waitlistPosition: placement.waitlistPosition,
    creditMembershipId: usesCredit ? choice.membershipId : null,
    bookedAt: new Date(),
    cancelledAt: null,
  };
  const result = existing
    ? await tx.booking.update({ where: { id: existing.id }, data, select: { id: true } })
    : await tx.booking.create({ data: { gymId: actor.gymId, sessionId: session.id, memberId, ...data }, select: { id: true } });

  await actor.audit(
    tx,
    {
      action: placement.status === "BOOKED" ? "booking.create" : "booking.waitlist",
      entityType: "Booking",
      entityId: result.id,
      changes: { sessionId: session.id, memberId, waitlistPosition: placement.waitlistPosition, usedCredit: usesCredit },
    },
    meta
  );
  return { bookingId: result.id, ...placement };
}

/** Cancel one active booking in a locked session; returns credit (before start) and promotes. */
async function cancelPlaced(tx: Tx, actor: BookingActor, session: SessionRow, bookingId: string, meta: RequestMeta) {
  const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  if (b.status !== "BOOKED" && b.status !== "WAITLISTED") throw new ValidationError("This booking is not active.");
  if (session.endsAt <= new Date()) throw new ValidationError("A finished class can't be changed.");

  const wasBooked = b.status === "BOOKED";
  const creditReturned = !!(wasBooked && b.creditMembershipId && refundsCredit(session.startsAt));
  if (creditReturned) await returnCredit(tx, b.creditMembershipId!);
  await tx.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", waitlistPosition: null, cancelledAt: new Date() }, select: { id: true } });
  await actor.audit(tx, { action: "booking.cancel", entityType: "Booking", entityId: b.id, changes: { sessionId: session.id, wasBooked, creditReturned } }, meta);

  const promoted = wasBooked ? await promoteFromWaitlist(tx, actor, session.id, 1, meta) : 0;
  if (!wasBooked || !promoted) await renumberWaitlist(tx, session.id);
  return { promoted, creditReturned };
}

// ─────────────────────────────── Staff ───────────────────────────────

export async function bookMember(ctx: TenantContext, input: { sessionId: string; memberId: string }, meta: RequestMeta) {
  assertCanBook(ctx);
  const actor = staffActor(ctx);
  return actor.run(async (tx) => {
    const session = await lockClassSession(tx, input.sessionId);
    const member = await tx.member.findFirst({ where: { id: input.memberId, ...visibilityWhere(ctx) }, select: { id: true, firstName: true, lastName: true } });
    if (!member) throw new NotFoundError("Member not found.");
    const placed = await placeBooking(tx, actor, session, member.id, meta);
    return { ...placed, name: `${member.firstName} ${member.lastName}` };
  });
}

export async function cancelBooking(ctx: TenantContext, bookingId: string, meta: RequestMeta) {
  const actor = staffActor(ctx);
  return actor.run(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, select: { sessionId: true } });
    if (!booking) throw new NotFoundError("Booking not found.");
    const session = await lockClassSession(tx, booking.sessionId);
    if (!ctx.permissions.has("classes.book") && !ctx.permissions.has("classes.manage")) assertCanManageSession(ctx, session);
    const { promoted } = await cancelPlaced(tx, actor, session, bookingId, meta);
    return { promoted };
  });
}

export async function markAttendance(ctx: TenantContext, bookingId: string, attended: boolean, meta: RequestMeta) {
  return inTenant(ctx, async (tx) => {
    const b = await tx.booking.findUnique({ where: { id: bookingId }, include: { session: true } });
    if (!b) throw new NotFoundError("Booking not found.");
    assertCanManageSession(ctx, b.session);
    if (!canMarkAttendance(b.session)) throw new ValidationError("Attendance can be marked from 30 minutes before the class until a day after it.");
    if (!["BOOKED", "ATTENDED", "NO_SHOW"].includes(b.status)) throw new ValidationError("Only confirmed bookings can be marked.");
    const status = attended ? "ATTENDED" : "NO_SHOW";
    await tx.booking.update({ where: { id: b.id }, data: { status }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "booking.attendance", entityType: "Booking", entityId: b.id, changes: { status } }, meta);
    return { status };
  });
}

// ─────────────────────────────── Members (member app) ───────────────────────────────

/**
 * A member books themselves. On top of the shared rules: the gym's plan must include class
 * bookings, the gym must not be read-only, and the class must be within the gym's booking window.
 */
export async function memberBookClass(ctx: MemberContext, sessionId: string, meta: RequestMeta) {
  assertMemberCanBook(ctx);
  const actor = memberActor(ctx);
  return actor.run(async (tx) => {
    const session = await lockClassSession(tx, sessionId);
    const horizon = Date.now() + ctx.gym.memberBookingDaysAhead * 86_400_000;
    if (session.startsAt.getTime() > horizon) {
      throw new ValidationError(`Classes open for booking ${ctx.gym.memberBookingDaysAhead} days ahead.`);
    }
    return placeBooking(tx, actor, session, ctx.memberId, meta);
  });
}

/**
 * A member cancels their own booking. Leaving a waitlist is always allowed; giving up a booked
 * spot closes memberCancelHours before the class (the gym's rule).
 */
export async function memberCancelBooking(ctx: MemberContext, bookingId: string, meta: RequestMeta) {
  assertMemberCanBook(ctx, { cancelling: true });
  const actor = memberActor(ctx);
  return actor.run(async (tx) => {
    const own = await tx.booking.findFirst({ where: { id: bookingId, memberId: ctx.memberId }, select: { sessionId: true, status: true } });
    if (!own) throw new NotFoundError("Booking not found.");
    const session = await lockClassSession(tx, own.sessionId);
    if (own.status === "BOOKED" && session.startsAt.getTime() - Date.now() < ctx.gym.memberCancelHours * 3_600_000) {
      throw new ValidationError(`Bookings can be cancelled up to ${ctx.gym.memberCancelHours} hours before the class. Please contact the gym.`);
    }
    return cancelPlaced(tx, actor, session, bookingId, meta);
  });
}

function assertMemberCanBook(ctx: MemberContext, opts: { cancelling?: boolean } = {}) {
  if (!ctx.plan?.features.classBookings) throw new ForbiddenError("Class booking isn't available at this gym.");
  if (!ctx.access.writable && !opts.cancelling) throw new ForbiddenError("Booking is paused at this gym right now. Please contact the gym.");
}
