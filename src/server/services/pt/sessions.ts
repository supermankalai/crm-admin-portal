import "server-only";
import { addDays, dayBounds, formatDateTime, fromDateString, isDateString, localDate, toDateString } from "@/domain/dates";
import { can } from "@/domain/permissions";
import { hasVideoRoom, liveRoomName } from "@/domain/live";
import { pickPackage, ptSessionBookedText, ptSessionCancelledText } from "@/domain/pt";
import { recordAudit } from "@/server/audit/tenant-audit";
import { assertLiveSessionsAvailable } from "../live/join";
import { closeLiveRoom } from "../live/rooms";
import type { Tx } from "@/server/db/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertWritable, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { coach, fullName } from "../fitness/common";
import { todayFor } from "../members/shared";
import { memberUserId, sendPtAlerts, staffUserId } from "./notify";
import { creditsUsed } from "./packages";

/**
 * Personal training sessions, for the web portal and the trainer app alike. A trainer books their
 * own sessions with their own clients; owners and managers (pt.manage) book for any trainer, with
 * that trainer's clients. No double-booking of the trainer (PT or class) or the client. The member
 * is told when a session is booked or cancelled, and so is the trainer when someone else did it.
 */

export type BookInput = { trainerId?: string; memberId: string; startsAt: Date; durationMinutes: number; focus: string | null; complimentary?: boolean; deliveryMode?: "IN_PERSON" | "ONLINE" };

async function lockTrainer(tx: Tx, staffId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"pt-trainer:" + staffId}))`;
}

/** The database's credit guard (pt_session_credit_guard) speaks in codes; say it plainly. */
function creditError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("pt:no_credit")) throw new ConflictError("That package has no sessions left. Try again to use another one.");
  if (message.includes("pt:package_cancelled")) throw new ConflictError("That package was cancelled.");
  if (message.includes("pt:package_dates")) throw new ValidationError("The session is outside the package's dates.");
  if (message.includes("pt:credit_mismatch")) throw new ValidationError("That package belongs to someone else.");
  throw error;
}

/**
 * Choose the credit for a session: the member's live package covering that day (for this
 * trainer or any), ending soonest. None left: a manager may book it complimentary; otherwise
 * it's refused if the gym requires credits, or booked uncovered if it doesn't.
 */
async function chooseCredit(tx: Tx, ctx: TenantContext, memberId: string, memberName: string, trainerId: string, startsAt: Date, complimentary: boolean) {
  if (complimentary) {
    if (!can(ctx.role, "pt.manage")) throw new ForbiddenError("Only owners and managers can book complimentary sessions.");
    return { purchaseId: null, complimentary: true, credit: null };
  }
  const day = localDate(startsAt, ctx.gym.timezone);
  const packages = await tx.ptPackagePurchase.findMany({
    where: { memberId, cancelledAt: null, startsOn: { lte: fromDateString(day) }, expiresOn: { gte: fromDateString(day) } },
    select: { id: true, name: true, trainerId: true, sessionsTotal: true, startsOn: true, expiresOn: true, cancelledAt: true },
  });
  const used = await creditsUsed(tx, packages.map((p) => p.id));
  const list = packages.map((p) => ({ ...p, startsOn: toDateString(p.startsOn), expiresOn: toDateString(p.expiresOn) }));
  const chosen = pickPackage(list, used, day, trainerId);
  if (chosen) return { purchaseId: chosen.id, complimentary: false, credit: { packageName: chosen.name, remainingAfter: chosen.sessionsTotal - (used.get(chosen.id) ?? 0) - 1 } };
  const gym = await tx.gym.findUniqueOrThrow({ where: { id: ctx.gym.id }, select: { ptCreditsRequired: true } });
  if (gym.ptCreditsRequired) {
    throw new ValidationError(
      `${memberName} has no PT sessions left for that day. Sell them a package first${can(ctx.role, "pt.manage") ? ", or book it as complimentary" : ""}.`,
      { memberId: ["No PT sessions left."] }
    );
  }
  return { purchaseId: null, complimentary: false, credit: null };
}

async function assertFree(tx: Tx, trainerId: string, actorId: string, memberId: string, startsAt: Date, endsAt: Date) {
  const overlap = { startsAt: { lt: endsAt }, endsAt: { gt: startsAt } };
  const pt = await tx.trainingSession.findFirst({ where: { status: "SCHEDULED", ...overlap, OR: [{ trainerId }, { memberId }] }, select: { trainerId: true } });
  if (pt) {
    if (pt.trainerId !== trainerId) throw new ConflictError("This client already has a session at that time.");
    throw new ConflictError(trainerId === actorId ? "You already have a session at that time." : "The trainer already has a session at that time.");
  }
  const cls = await tx.classSession.findFirst({ where: { trainerId, status: "SCHEDULED", ...overlap }, select: { id: true } });
  if (cls) throw new ConflictError(trainerId === actorId ? "You're teaching a class at that time." : "The trainer is teaching a class at that time.");
}

export async function bookSession(ctx: TenantContext, input: BookInput, meta: RequestMeta) {
  const c = coach(ctx);
  assertWritable(ctx);
  const trainerId = input.trainerId ?? c.staffId;
  const forOther = trainerId !== c.staffId;
  if (forOther && !can(ctx.role, "pt.manage")) throw new ForbiddenError("You can only book your own sessions.");
  const { startsAt } = input;
  const deliveryMode = input.deliveryMode ?? "IN_PERSON";
  if (deliveryMode === "ONLINE") assertLiveSessionsAvailable(ctx);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
  if (Number.isNaN(startsAt.getTime())) throw new ValidationError("Choose a start time.", { startsAt: ["Choose a start time."] });
  if (startsAt.getTime() < Date.now() - 5 * 60_000) throw new ValidationError("Choose a time in the future.", { startsAt: ["Choose a time in the future."] });
  if (startsAt.getTime() > Date.now() + 180 * 86_400_000) throw new ValidationError("Sessions can be booked up to 6 months ahead.", { startsAt: ["Up to 6 months ahead."] });

  return inTenant(ctx, async (tx) => {
    const trainer = await tx.staffMember.findFirst({ where: { id: trainerId, status: "ACTIVE" }, select: { id: true, role: true, userId: true, user: { select: { name: true } } } });
    if (!trainer || (forOther && trainer.role !== "TRAINER")) throw new ValidationError("Choose an active trainer.", { trainerId: ["Choose an active trainer."] });
    const member = await tx.member.findFirst({ where: { id: input.memberId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } });
    if (!member) throw new NotFoundError("Member not found.");
    // Trainers coach their assigned clients only. (Owners and managers coaching themselves may book anyone.)
    if (trainer.role === "TRAINER") {
      const assigned = await tx.trainerClient.findUnique({ where: { trainerId_memberId: { trainerId, memberId: member.id } }, select: { id: true } });
      if (!assigned) throw forOther ? new ValidationError(`${fullName(member)} isn't a client of ${trainer.user.name}. Assign them first.`) : new ForbiddenError("This member isn't one of your clients.");
    }
    await lockTrainer(tx, trainerId);
    // One booking at a time per client too: two trainers can't both take their last credit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"pt-member:" + member.id}))`;
    await assertFree(tx, trainerId, c.staffId, member.id, startsAt, endsAt);
    const credit = await chooseCredit(tx, ctx, member.id, fullName(member), trainerId, startsAt, input.complimentary ?? false);
    const row = await tx.trainingSession
      .create({
        data: { gymId: ctx.gym.id, trainerId, memberId: member.id, startsAt, endsAt, focus: input.focus, bookedById: c.staffId, purchaseId: credit.purchaseId, complimentary: credit.complimentary, deliveryMode },
        select: { id: true },
      })
      .catch(creditError);
    await recordAudit(tx, ctx, {
      action: "training_session.create",
      entityType: "TrainingSession",
      entityId: row.id,
      changes: { memberId: member.id, trainerId, startsAt: startsAt.toISOString(), minutes: input.durationMinutes, purchaseId: credit.purchaseId, complimentary: credit.complimentary, deliveryMode },
    }, meta);

    const when = formatDateTime(startsAt, ctx.gym.timezone);
    const memberUser = await memberUserId(tx, member.id);
    await sendPtAlerts(tx, ctx.gym.id, [
      memberUser ? { userId: memberUser, type: "PT_SESSION_BOOKED", ...ptSessionBookedText(trainer.user.name, when), entityType: "TrainingSession", entityId: row.id, subject: row.id } : null,
      forOther ? { userId: trainer.userId, type: "PT_SESSION_BOOKED", ...ptSessionBookedText(fullName(member), when), entityType: "TrainingSession", entityId: row.id, subject: row.id } : null,
    ]);
    return { id: row.id, credit: credit.credit, complimentary: credit.complimentary };
  });
}

export async function closeSession(ctx: TenantContext, id: string, status: "COMPLETED" | "CANCELLED" | "NO_SHOW", meta: RequestMeta) {
  const c = coach(ctx);
  assertWritable(ctx);
  const isManager = can(ctx.role, "pt.manage");
  const result = await inTenant(ctx, async (tx) => {
    const s = await tx.trainingSession.findFirst({
      where: { id },
      select: { id: true, trainerId: true, memberId: true, status: true, startsAt: true, deliveryMode: true, member: { select: { firstName: true, lastName: true } }, trainer: { select: { user: { select: { name: true } } } } },
    });
    if (!s) throw new NotFoundError("Session not found.");
    if (!isManager && s.trainerId !== c.staffId) throw new ForbiddenError("You can only change your own sessions.");
    if (s.status !== "SCHEDULED") throw new ConflictError("This session has already been closed.");
    if (status !== "CANCELLED" && s.startsAt.getTime() > Date.now()) throw new ValidationError("A session can be marked done or missed once it has started.");
    await tx.trainingSession.update({ where: { id }, data: { status }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "training_session.update", entityType: "TrainingSession", entityId: id, changes: { status } }, meta);

    // Only a cancellation of a session still ahead is news to anyone.
    if (status === "CANCELLED" && s.startsAt.getTime() > Date.now()) {
      const when = formatDateTime(s.startsAt, ctx.gym.timezone);
      const memberUser = await memberUserId(tx, s.memberId);
      const trainerUser = s.trainerId !== c.staffId ? await staffUserId(tx, s.trainerId) : null;
      await sendPtAlerts(tx, ctx.gym.id, [
        memberUser ? { userId: memberUser, type: "PT_SESSION_CANCELLED", ...ptSessionCancelledText(s.trainer.user.name, when), entityType: "TrainingSession", entityId: s.id, subject: s.id } : null,
        trainerUser ? { userId: trainerUser, type: "PT_SESSION_CANCELLED", ...ptSessionCancelledText(fullName(s.member), when), entityType: "TrainingSession", entityId: s.id, subject: s.id } : null,
      ]);
    }
    return { closeRoom: status === "CANCELLED" && hasVideoRoom(s.deliveryMode) };
  });
  // A cancelled online session's call ends now. (Done or no-show: no new joins, and the call
  // closes when its window does.)
  if (result.closeRoom) await closeLiveRoom(liveRoomName(ctx.gym.id, "pt", id));
  return { ok: true as const };
}

export type SessionFilters = { from?: string; to?: string; trainerId?: string; status?: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW" };

/** PT sessions in a date range (default: this week from today). Trainers see only their own. */
export async function listSessions(ctx: TenantContext, f: SessionFilters) {
  const c = coach(ctx);
  const isManager = can(ctx.role, "pt.manage");
  const today = todayFor(ctx);
  const from = f.from && isDateString(f.from) ? f.from : today;
  let to = f.to && isDateString(f.to) ? f.to : addDays(from, 6);
  if (to < from) to = from;
  if (to > addDays(from, 62)) to = addDays(from, 62);
  const start = dayBounds(from, ctx.gym.timezone).start;
  const end = dayBounds(to, ctx.gym.timezone).end;
  const trainerId = isManager ? f.trainerId || undefined : c.staffId;
  return inTenant(ctx, async (tx) => {
    const rows = await tx.trainingSession.findMany({
      where: { startsAt: { gte: start, lt: end }, ...(trainerId ? { trainerId } : {}), ...(f.status ? { status: f.status } : {}) },
      orderBy: { startsAt: "asc" },
      take: 500,
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
        focus: true,
        trainerId: true,
        trainer: { select: { user: { select: { name: true } } } },
        member: { select: { id: true, firstName: true, lastName: true } },
        complimentary: true,
        deliveryMode: true,
        purchase: { select: { name: true } },
      },
    });
    return {
      from,
      to,
      sessions: rows.map((s) => ({
        id: s.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: s.status,
        focus: s.focus,
        trainer: { id: s.trainerId, name: s.trainer.user.name },
        member: { id: s.member.id, name: fullName(s.member) },
        cover: s.purchase ? s.purchase.name : s.complimentary ? "Complimentary" : null,
        canChange: isManager || s.trainerId === c.staffId,
        deliveryMode: s.deliveryMode,
        isMine: s.trainerId === c.staffId,
      })),
    };
  });
}
