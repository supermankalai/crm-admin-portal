import "server-only";
import { addDays, dayBounds, localDate, localDateTime } from "@/domain/dates";
import { ClassRuleError, overlaps, refundsCredit } from "@/domain/classes";
import { recordAudit } from "@/server/audit/tenant-audit";
import type { Tx } from "@/server/db/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import type { SessionInput } from "@/lib/validation/classes";

/** Trainers (no classes.manage and no classes.book) only see and manage their own classes. */
export function ownSessionsOnly(ctx: TenantContext): boolean {
  return !ctx.permissions.has("classes.manage") && !ctx.permissions.has("classes.book");
}

function sessionScope(ctx: TenantContext) {
  return ownSessionsOnly(ctx) ? { trainerId: ctx.staffId ?? "__none__" } : {};
}

/** May this user change this session? Managers: any. Trainers: their own (classes.manageOwn). */
export function assertCanManageSession(ctx: TenantContext, session: { trainerId: string }) {
  if (ctx.permissions.has("classes.manage")) return;
  if (ctx.permissions.has("classes.manageOwn") && session.trainerId === ctx.staffId) return;
  throw new ForbiddenError("You can only manage your own classes.");
}

export function rule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ClassRuleError) throw new ValidationError(error.message);
    throw error;
  }
}

export async function listWeek(ctx: TenantContext, monday: string, filters: { trainerId?: string; locationId?: string } = {}) {
  assertCan(ctx, "classes.view");
  const tz = ctx.gym.timezone;
  const from = dayBounds(monday, tz).start;
  const to = dayBounds(addDays(monday, 6), tz).end;
  return inTenant(ctx, async (tx) => {
    const sessions = await tx.classSession.findMany({
      where: {
        startsAt: { gte: from, lt: to },
        ...sessionScope(ctx),
        ...(filters.trainerId ? { trainerId: filters.trainerId } : {}),
        ...(filters.locationId ? { room: { locationId: filters.locationId } } : {}),
      },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        status: true,
        trainerId: true,
        classType: { select: { name: true, color: true } },
        room: { select: { name: true, location: { select: { name: true } } } },
        trainer: { select: { user: { select: { name: true } } } },
        bookings: { where: { status: { in: ["BOOKED", "ATTENDED", "WAITLISTED"] } }, select: { status: true } },
      },
    });
    return sessions.map((s) => ({
      ...s,
      date: localDate(s.startsAt, tz),
      booked: s.bookings.filter((b) => b.status !== "WAITLISTED").length,
      waitlisted: s.bookings.filter((b) => b.status === "WAITLISTED").length,
    }));
  });
}

async function assertNoConflicts(tx: Tx, slots: { startsAt: Date; endsAt: Date }[], trainerId: string, roomId: string, ignoreSessionId?: string) {
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) if (overlaps(slots[i], slots[j])) throw new ValidationError("These repeating classes overlap each other.");
  }
  for (const slot of slots) {
    const clash = await tx.classSession.findFirst({
      where: {
        status: "SCHEDULED",
        id: ignoreSessionId ? { not: ignoreSessionId } : undefined,
        startsAt: { lt: slot.endsAt },
        endsAt: { gt: slot.startsAt },
        OR: [{ trainerId }, { roomId }],
      },
      select: { trainerId: true, startsAt: true, classType: { select: { name: true } }, room: { select: { name: true } } },
    });
    if (clash) {
      const who = clash.trainerId === trainerId ? "The trainer is already teaching" : `${clash.room.name} is already booked for`;
      throw new ValidationError(`${who} ${clash.classType.name} at that time (${clash.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC).`);
    }
  }
}

/** Schedule a class, optionally repeating weekly. Trainer and room double-booking is refused. */
export async function createSessions(ctx: TenantContext, input: SessionInput, meta: RequestMeta) {
  assertCan(ctx, "classes.manage");
  const tz = ctx.gym.timezone;
  return inTenant(ctx, async (tx) => {
    const type = await tx.classType.findUnique({ where: { id: input.classTypeId }, select: { id: true, name: true } });
    if (!type) throw new ValidationError("Choose a class type.", { classTypeId: ["Choose a class type"] });
    const room = await tx.room.findUnique({ where: { id: input.roomId }, select: { id: true, capacity: true, name: true } });
    if (!room) throw new ValidationError("Choose a room.", { roomId: ["Choose a room"] });
    const trainer = await tx.staffMember.findFirst({ where: { id: input.trainerId, status: "ACTIVE", role: { in: ["TRAINER", "MANAGER", "OWNER"] } }, select: { id: true } });
    if (!trainer) throw new ValidationError("Choose a trainer.", { trainerId: ["Choose a trainer"] });
    if (input.capacity > room.capacity) {
      throw new ValidationError(`${room.name} holds at most ${room.capacity} people.`, { capacity: [`At most ${room.capacity} for ${room.name}`] });
    }

    const slots = Array.from({ length: input.repeatWeeks }, (_, i) => {
      const startsAt = localDateTime(addDays(input.date, i * 7), input.startTime, tz);
      return { startsAt, endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000) };
    });
    if (slots[0].startsAt <= new Date()) throw new ValidationError("Classes must be scheduled in the future.", { startTime: ["Pick a future time"] });
    await assertNoConflicts(tx, slots, trainer.id, room.id);

    await tx.classSession.createMany({
      data: slots.map((s) => ({ gymId: ctx.gym.id, classTypeId: type.id, trainerId: trainer.id, roomId: room.id, capacity: input.capacity, ...s })),
    });
    await recordAudit(tx, ctx, {
      action: "class.schedule",
      entityType: "ClassSession",
      changes: { classType: type.name, room: room.name, first: slots[0].startsAt, weeks: input.repeatWeeks, capacity: input.capacity },
    }, meta);
    return { created: slots.length };
  });
}

export async function getSession(ctx: TenantContext, sessionId: string) {
  assertCan(ctx, "classes.view");
  return inTenant(ctx, async (tx) => {
    const session = await tx.classSession.findFirst({
      where: { id: sessionId, ...sessionScope(ctx) },
      include: {
        classType: true,
        room: { include: { location: { select: { name: true } } } },
        trainer: { select: { id: true, user: { select: { name: true } } } },
        bookings: {
          orderBy: [{ status: "asc" }, { waitlistPosition: "asc" }, { bookedAt: "asc" }],
          include: { member: { select: { id: true, firstName: true, lastName: true, memberNumber: true, photoFileId: true } } },
        },
      },
    });
    if (!session) throw new NotFoundError("Class not found.");
    return session;
  });
}

/** Change trainer, room or capacity. Capacity can't drop below confirmed bookings; extra spots fill from the waitlist. */
export async function updateSession(ctx: TenantContext, input: { sessionId: string; trainerId: string; roomId: string; capacity: number }, meta: RequestMeta) {
  assertCan(ctx, "classes.view");
  return inTenant(ctx, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ClassSession" WHERE id = ${input.sessionId} FOR UPDATE`;
    const session = await tx.classSession.findUnique({ where: { id: input.sessionId } });
    if (!session) throw new NotFoundError("Class not found.");
    assertCanManageSession(ctx, session);
    const changesStaffing = input.trainerId !== session.trainerId || input.roomId !== session.roomId;
    if (changesStaffing && !ctx.permissions.has("classes.manage")) throw new ForbiddenError("Only managers can change the trainer or room.");
    if (session.status !== "SCHEDULED" || session.endsAt <= new Date()) throw new ValidationError("Only upcoming classes can be changed.");

    if (input.trainerId !== session.trainerId) {
      // Same rule as scheduling: only active staff who can teach.
      const trainer = await tx.staffMember.findFirst({ where: { id: input.trainerId, status: "ACTIVE", role: { in: ["TRAINER", "MANAGER", "OWNER"] } }, select: { id: true } });
      if (!trainer) throw new ValidationError("Choose a trainer.", { trainerId: ["Choose an active trainer"] });
    }
    const room = await tx.room.findUnique({ where: { id: input.roomId }, select: { capacity: true, name: true } });
    if (!room) throw new ValidationError("Choose a room.");
    if (input.capacity > room.capacity) throw new ValidationError(`${room.name} holds at most ${room.capacity} people.`, { capacity: [`At most ${room.capacity}`] });
    const booked = await tx.booking.count({ where: { sessionId: session.id, status: "BOOKED" } });
    if (input.capacity < booked) throw new ValidationError(`${booked} people are already booked — capacity can't be lower.`, { capacity: [`At least ${booked}`] });
    if (changesStaffing) await assertNoConflicts(tx, [session], input.trainerId, input.roomId, session.id);

    await tx.classSession.update({ where: { id: session.id }, data: { trainerId: input.trainerId, roomId: input.roomId, capacity: input.capacity }, select: { id: true } });
    const { promoteFromWaitlist } = await import("./bookings");
    const promoted = await promoteFromWaitlist(tx, ctx, session.id, input.capacity - booked, meta);
    await recordAudit(tx, ctx, {
      action: "class.update",
      entityType: "ClassSession",
      entityId: session.id,
      changes: { trainerId: { from: session.trainerId, to: input.trainerId }, roomId: { from: session.roomId, to: input.roomId }, capacity: { from: session.capacity, to: input.capacity }, promoted },
    }, meta);
    return { promoted };
  });
}

/** Cancel a class: every booking is cancelled and class-pack credits are given back. */
export async function cancelSession(ctx: TenantContext, sessionId: string, reason: string, meta: RequestMeta) {
  assertCan(ctx, "classes.view");
  return inTenant(ctx, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ClassSession" WHERE id = ${sessionId} FOR UPDATE`;
    const session = await tx.classSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundError("Class not found.");
    assertCanManageSession(ctx, session);
    if (session.status !== "SCHEDULED") throw new ValidationError("This class is not scheduled.");
    if (session.endsAt <= new Date()) throw new ValidationError("A finished class can't be cancelled.");

    const active = await tx.booking.findMany({ where: { sessionId, status: { in: ["BOOKED", "WAITLISTED"] } }, select: { id: true, creditMembershipId: true } });
    for (const b of active) {
      if (b.creditMembershipId && refundsCredit(session.startsAt)) {
        await tx.membership.update({ where: { id: b.creditMembershipId }, data: { classCreditsRemaining: { increment: 1 } }, select: { id: true } });
      }
    }
    await tx.booking.updateMany({ where: { sessionId, status: { in: ["BOOKED", "WAITLISTED"] } }, data: { status: "CANCELLED", waitlistPosition: null, cancelledAt: new Date() } });
    await tx.classSession.update({ where: { id: sessionId }, data: { status: "CANCELLED" }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "class.cancel", entityType: "ClassSession", entityId: sessionId, changes: { reason, bookingsCancelled: active.length } }, meta);
    return { bookingsCancelled: active.length };
  });
}
