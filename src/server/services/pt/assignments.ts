import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { fromDateString, toDateString } from "@/domain/dates";
import { ptAssignedMemberText, ptAssignedTrainerText, ptEndedMemberText, ptEndedTrainerText, type PtGoal, type PtTargets } from "@/domain/pt";
import { recordAudit } from "@/server/audit/tenant-audit";
import { decryptJson, encryptJson } from "@/server/crypto";
import type { Tx } from "@/server/db/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, assertWritable, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { fullName } from "../fitness/common";
import { todayFor } from "../members/shared";
import { memberUserId, sendPtAlerts, staffUserId } from "./notify";

/**
 * Who trains whom. Owners and managers assign a trainer to a member (with a goal and targets),
 * change the goal, and end the assignment. Ending moves the row to PtAssignmentHistory, so the
 * trainer loses access straight away (app_is_trainer_of reads only open assignments) while the
 * record of who coached whom is kept. Member and trainer are both told each time.
 */

type TargetModel = "TrainerClient" | "PtAssignmentHistory";
const targetsCrypto = (gymId: string, model: TargetModel, id: string) => ({ gymId, model, field: "targets", recordId: id });

export function encryptTargets(gymId: string, model: TargetModel, id: string, targets: PtTargets | null) {
  return targets ? encryptJson(targets, targetsCrypto(gymId, model, id)) : null;
}

export function readTargets(gymId: string, model: TargetModel, id: string, enc: string | null): PtTargets | null {
  if (!enc) return null;
  try {
    return decryptJson<PtTargets>(enc, targetsCrypto(gymId, model, id));
  } catch (error) {
    logger.error("pt targets decryption failed", { gymId, model, recordId: id, error: (error as Error).message });
    return null;
  }
}

function manager(ctx: TenantContext) {
  assertCan(ctx, "pt.manage");
  assertWritable(ctx);
  if (!ctx.staffId) throw new ForbiddenError("Only gym staff can do this.");
  return ctx.staffId;
}

export type GoalInput = { goal: PtGoal | null; targets: PtTargets | null };

export async function assignTrainer(ctx: TenantContext, input: { memberId: string; trainerId: string } & GoalInput, meta: RequestMeta) {
  const actor = manager(ctx);
  return inTenant(ctx, async (tx) => {
    const trainer = await tx.staffMember.findFirst({ where: { id: input.trainerId, status: "ACTIVE", role: "TRAINER" }, select: { id: true, userId: true, user: { select: { name: true } } } });
    if (!trainer) throw new ValidationError("Clients can only be assigned to active trainers.", { trainerId: ["Choose an active trainer."] });
    const member = await tx.member.findFirst({ where: { id: input.memberId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } });
    if (!member) throw new NotFoundError("Member not found.");
    const existing = await tx.trainerClient.findUnique({ where: { trainerId_memberId: { trainerId: trainer.id, memberId: member.id } }, select: { id: true } });
    if (existing) throw new ConflictError(`${fullName(member)} is already a client of ${trainer.user.name}.`);

    const id = createId();
    await tx.trainerClient.create({
      data: {
        id,
        gymId: ctx.gym.id,
        trainerId: trainer.id,
        memberId: member.id,
        goal: input.goal,
        targetsEnc: encryptTargets(ctx.gym.id, "TrainerClient", id, input.targets),
        startedOn: fromDateString(todayFor(ctx)),
        assignedById: actor,
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, { action: "pt.assign", entityType: "Member", entityId: member.id, changes: { trainerId: trainer.id, assignmentId: id, goal: input.goal, targets: input.targets !== null } }, meta);
    const memberUser = await memberUserId(tx, member.id);
    await sendPtAlerts(tx, ctx.gym.id, [
      memberUser ? { userId: memberUser, type: "PT_ASSIGNED", ...ptAssignedMemberText(trainer.user.name, input.goal), entityType: "TrainerClient", entityId: id, subject: id } : null,
      trainer.userId !== ctx.user.id ? { userId: trainer.userId, type: "PT_ASSIGNED", ...ptAssignedTrainerText(fullName(member), input.goal), entityType: "TrainerClient", entityId: id, subject: id } : null,
    ]);
    return { assignmentId: id };
  });
}

export async function updateGoal(ctx: TenantContext, input: { assignmentId: string } & GoalInput, meta: RequestMeta) {
  manager(ctx);
  return inTenant(ctx, async (tx) => {
    const a = await tx.trainerClient.findFirst({ where: { id: input.assignmentId }, select: { id: true, memberId: true, goal: true } });
    if (!a) throw new NotFoundError("Assignment not found.");
    await tx.trainerClient.update({
      where: { id: a.id },
      data: { goal: input.goal, targetsEnc: encryptTargets(ctx.gym.id, "TrainerClient", a.id, input.targets) },
      select: { id: true },
    });
    await recordAudit(tx, ctx, { action: "pt.goal_update", entityType: "Member", entityId: a.memberId, changes: { assignmentId: a.id, goal: { from: a.goal, to: input.goal }, targets: input.targets !== null } }, meta);
    return { saved: true as const };
  });
}

type OpenAssignment = { id: string; trainerId: string; memberId: string; goal: PtGoal | null; targetsEnc: string | null; startedOn: Date; assignedById: string | null };

/**
 * Close one assignment inside a transaction: history row (targets re-encrypted for it), future
 * PT sessions between the two cancelled, the open row removed, both people told.
 */
async function closeAssignment(tx: Tx, ctx: TenantContext, a: OpenAssignment, endedById: string, reason: string | null) {
  const historyId = createId();
  await tx.ptAssignmentHistory.create({
    data: {
      id: historyId,
      gymId: ctx.gym.id,
      trainerId: a.trainerId,
      memberId: a.memberId,
      goal: a.goal,
      targetsEnc: encryptTargets(ctx.gym.id, "PtAssignmentHistory", historyId, readTargets(ctx.gym.id, "TrainerClient", a.id, a.targetsEnc)),
      startedOn: a.startedOn,
      assignedById: a.assignedById,
      endedAt: new Date(),
      endedById,
      endReason: reason,
    },
    select: { id: true },
  });
  const cancelled = await tx.trainingSession.updateMany({ where: { trainerId: a.trainerId, memberId: a.memberId, status: "SCHEDULED", startsAt: { gt: new Date() } }, data: { status: "CANCELLED" } });
  await tx.trainerClient.delete({ where: { id: a.id } });

  const [member, trainer] = await Promise.all([
    tx.member.findFirst({ where: { id: a.memberId }, select: { firstName: true, lastName: true } }),
    tx.staffMember.findFirst({ where: { id: a.trainerId }, select: { userId: true, status: true, user: { select: { name: true } } } }),
  ]);
  const memberUser = await memberUserId(tx, a.memberId);
  const trainerUser = trainer?.status === "ACTIVE" && trainer.userId !== ctx.user.id ? await staffUserId(tx, a.trainerId) : null;
  await sendPtAlerts(tx, ctx.gym.id, [
    memberUser && trainer ? { userId: memberUser, type: "PT_ENDED", ...ptEndedMemberText(trainer.user.name), entityType: "PtAssignmentHistory", entityId: historyId, subject: historyId } : null,
    trainerUser && member ? { userId: trainerUser, type: "PT_ENDED", ...ptEndedTrainerText(fullName(member)), entityType: "PtAssignmentHistory", entityId: historyId, subject: historyId } : null,
  ]);
  return { historyId, cancelledSessions: cancelled.count };
}

const OPEN_SELECT = { id: true, trainerId: true, memberId: true, goal: true, targetsEnc: true, startedOn: true, assignedById: true } as const;

export async function endAssignment(ctx: TenantContext, input: { assignmentId: string; reason: string | null }, meta: RequestMeta) {
  const actor = manager(ctx);
  return inTenant(ctx, async (tx) => {
    const a = await tx.trainerClient.findFirst({ where: { id: input.assignmentId }, select: OPEN_SELECT });
    if (!a) throw new NotFoundError("Assignment not found. It may have ended already.");
    const r = await closeAssignment(tx, ctx, a, actor, input.reason);
    await recordAudit(tx, ctx, { action: "pt.end", entityType: "Member", entityId: a.memberId, changes: { trainerId: a.trainerId, assignmentId: a.id, historyId: r.historyId, cancelledSessions: r.cancelledSessions } }, meta);
    return { cancelledSessions: r.cancelledSessions };
  });
}

/** By trainer + member (the staff profile's client list). */
export async function endAssignmentFor(ctx: TenantContext, trainerId: string, memberId: string, meta: RequestMeta) {
  const a = await inTenant(ctx, (tx) => tx.trainerClient.findUnique({ where: { trainerId_memberId: { trainerId, memberId } }, select: { id: true } }));
  if (!a) throw new NotFoundError("This member isn't a client of that trainer.");
  return endAssignment(ctx, { assignmentId: a.id, reason: null }, meta);
}

/** A trainer leaving the gym: all their assignments end (inside the caller's transaction). */
export async function endAllForTrainer(tx: Tx, ctx: TenantContext, trainerId: string) {
  if (!ctx.staffId) throw new ForbiddenError("Only gym staff can do this.");
  const open = await tx.trainerClient.findMany({ where: { trainerId }, select: OPEN_SELECT });
  for (const a of open) await closeAssignment(tx, ctx, a, ctx.staffId, "Trainer left the gym");
  return open.length;
}

/** Current assignments of one member, with decrypted targets (callers check access first). */
export async function assignmentsOf(tx: Tx, gymId: string, memberId: string) {
  const rows = await tx.trainerClient.findMany({
    where: { memberId },
    orderBy: { startedOn: "asc" },
    select: { ...OPEN_SELECT, trainer: { select: { user: { select: { name: true } } } }, assignedBy: { select: { user: { select: { name: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id,
    trainerId: r.trainerId,
    trainerName: r.trainer.user.name,
    goal: r.goal,
    targets: readTargets(gymId, "TrainerClient", r.id, r.targetsEnc),
    startedOn: toDateString(r.startedOn),
    assignedBy: r.assignedBy?.user.name ?? null,
  }));
}
