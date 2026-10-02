import "server-only";
import { localDate, toDateString } from "@/domain/dates";
import { assertBookable, bookingPlacement, canMarkAttendance, ClassRuleError, membershipForBooking, refundsCredit, type BookableMembership } from "@/domain/classes";
import { recordAudit } from "@/server/audit/tenant-audit";
import type { Tx } from "@/server/db/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { assertFeature } from "@/server/plan/limits";
import type { RequestMeta } from "@/server/security/request-meta";
import { inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { visibilityWhere } from "../members/shared";
import { assertCanManageSession, rule } from "./sessions";

/**
 * Bookings. Every change locks the class session row first (SELECT … FOR UPDATE), so capacity
 * checks and waitlist positions are decided one booking at a time: no overbooking even when
 * many people try to take the last spot at once.
 */

async function lockSession(tx: Tx, sessionId: string) {
  await tx.$queryRaw`SELECT id FROM "ClassSession" WHERE id = ${sessionId} FOR UPDATE`;
  const session = await tx.classSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new NotFoundError("Class not found.");
  return session;
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
  if (updated.count !== 1) throw new ValidationError("The member's class pack has no classes left.");
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
 * session row already locked.
 */
export async function promoteFromWaitlist(tx: Tx, ctx: TenantContext, sessionId: string, freeSpots: number, meta: RequestMeta) {
  if (freeSpots <= 0) return 0;
  const session = await tx.classSession.findUniqueOrThrow({ where: { id: sessionId }, select: { startsAt: true, status: true } });
  if (session.status !== "SCHEDULED" || session.startsAt <= new Date()) return 0;
  const classDate = localDate(session.startsAt, ctx.gym.timezone);
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
    await recordAudit(tx, ctx, { action: "booking.promote", entityType: "Booking", entityId: b.id, changes: { sessionId } }, meta);
    promoted++;
  }
  if (promoted) await renumberWaitlist(tx, sessionId);
  return promoted;
}

export async function bookMember(ctx: TenantContext, input: { sessionId: string; memberId: string }, meta: RequestMeta) {
  assertCanBook(ctx);
  return inTenant(ctx, async (tx) => {
    const session = await lockSession(tx, input.sessionId);
    rule(() => assertBookable(session));
    const member = await tx.member.findFirst({ where: { id: input.memberId, ...visibilityWhere(ctx) }, select: { id: true, firstName: true, lastName: true } });
    if (!member) throw new NotFoundError("Member not found.");

    const existing = await tx.booking.findUnique({ where: { sessionId_memberId: { sessionId: session.id, memberId: member.id } } });
    if (existing && existing.status !== "CANCELLED") {
      throw new ValidationError(existing.status === "WAITLISTED" ? `Already on the waitlist (position ${existing.waitlistPosition}).` : "Already booked into this class.");
    }

    const memberships = await bookableMemberships(tx, member.id);
    const choice = rule(() => membershipForBooking(memberships, localDate(session.startsAt, ctx.gym.timezone)));

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
      : await tx.booking.create({ data: { gymId: ctx.gym.id, sessionId: session.id, memberId: member.id, ...data }, select: { id: true } });

    await recordAudit(tx, ctx, {
      action: placement.status === "BOOKED" ? "booking.create" : "booking.waitlist",
      entityType: "Booking",
      entityId: result.id,
      changes: { sessionId: session.id, memberId: member.id, waitlistPosition: placement.waitlistPosition, usedCredit: usesCredit },
    }, meta);
    return { bookingId: result.id, ...placement, name: `${member.firstName} ${member.lastName}` };
  });
}

export async function cancelBooking(ctx: TenantContext, bookingId: string, meta: RequestMeta) {
  return inTenant(ctx, async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, select: { sessionId: true } });
    if (!booking) throw new NotFoundError("Booking not found.");
    const session = await lockSession(tx, booking.sessionId);
    if (!ctx.permissions.has("classes.book") && !ctx.permissions.has("classes.manage")) assertCanManageSession(ctx, session);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.status !== "BOOKED" && b.status !== "WAITLISTED") throw new ValidationError("This booking is not active.");
    if (session.endsAt <= new Date()) throw new ValidationError("A finished class can't be changed.");

    const wasBooked = b.status === "BOOKED";
    if (wasBooked && b.creditMembershipId && refundsCredit(session.startsAt)) await returnCredit(tx, b.creditMembershipId);
    await tx.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", waitlistPosition: null, cancelledAt: new Date() }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "booking.cancel", entityType: "Booking", entityId: b.id, changes: { sessionId: session.id, wasBooked } }, meta);

    const promoted = wasBooked ? await promoteFromWaitlist(tx, ctx, session.id, 1, meta) : 0;
    if (!wasBooked || !promoted) await renumberWaitlist(tx, session.id);
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

