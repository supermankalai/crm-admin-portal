import "server-only";
import { createId } from "@paralleldrive/cuid2";
import type { WorkoutPlanInput } from "@/lib/validation/fitness";
import { recordAudit } from "@/server/audit/tenant-audit";
import { encryptOptional, tryDecrypt } from "@/server/crypto";
import type { Tx } from "@/server/db/context";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertWritable, inTenant } from "@/server/tenant/guards";
import { inMember, type MemberContext } from "@/server/tenant/member";
import type { TenantContext } from "@/server/tenant/types";
import { assertCanCoach, assertMemberWritable, coach, fullName, type Coach } from "./common";

/**
 * Workout plans: written by a trainer for a client (or as a template), read by the member, who
 * marks days as done. Plan notes and workout notes are encrypted. Who sees and edits what is
 * enforced by RLS (see the trainer_fitness migration); these functions give clear errors first.
 */

const notesCrypto = (gymId: string, planId: string) => ({ gymId, model: "WorkoutPlan", field: "notes", recordId: planId });
const completionCrypto = (gymId: string, id: string) => ({ gymId, model: "WorkoutCompletion", field: "note", recordId: id });

const DAY_SELECT = {
  id: true,
  title: true,
  position: true,
  exercises: { orderBy: { position: "asc" as const }, select: { id: true, name: true, sets: true, reps: true, restSeconds: true, notes: true } },
};

const ROW_SELECT = {
  id: true,
  title: true,
  status: true,
  updatedAt: true,
  member: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { days: true } },
};

type PlanRow = { id: string; title: string; status: "DRAFT" | "ACTIVE" | "ARCHIVED"; updatedAt: Date; member: { id: string; firstName: string; lastName: string } | null; _count: { days: number } };

export function planRow(p: PlanRow) {
  return { id: p.id, title: p.title, status: p.status, member: p.member ? { id: p.member.id, name: fullName(p.member) } : null, dayCount: p._count.days, updatedAt: p.updatedAt.toISOString() };
}

export function planRowsFor(tx: Tx, where: object) {
  return tx.workoutPlan.findMany({ where, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 100, select: ROW_SELECT });
}

// Nested creates inherit gymId from the parent (it's part of the composite foreign key).
function exerciseData(e: WorkoutPlanInput["days"][number]["exercises"][number], position: number) {
  return { position, name: e.name, sets: e.sets, reps: e.reps, restSeconds: e.restSeconds, notes: e.notes };
}

function nestedDays(days: WorkoutPlanInput["days"], from = 0) {
  return days.map((d, i) => ({ position: from + i, title: d.title, exercises: { create: d.exercises.map(exerciseData) } }));
}

// ─────────────────────────────── Trainer ───────────────────────────────

/** Plans I wrote, plus my clients' plans (managers too: this is their own coaching list). */
export async function listPlans(ctx: TenantContext) {
  const c = coach(ctx);
  const rows = await inTenant(ctx, (tx) => planRowsFor(tx, { OR: [{ trainerId: c.staffId }, { member: { trainers: { some: { trainerId: c.staffId } } } }] }));
  return { plans: rows.map(planRow) };
}

export async function getPlan(ctx: TenantContext, planId: string) {
  const c = coach(ctx);
  const p = await inTenant(ctx, (tx) =>
    tx.workoutPlan.findFirst({
      where: { id: planId },
      select: { ...ROW_SELECT, trainerId: true, notesEnc: true, trainer: { select: { user: { select: { name: true } } } }, days: { orderBy: { position: "asc" }, select: DAY_SELECT } },
    })
  );
  if (!p) throw new NotFoundError("Plan not found.");
  return {
    id: p.id,
    title: p.title,
    notes: tryDecrypt(p.notesEnc, notesCrypto(ctx.gym.id, p.id)),
    status: p.status,
    member: p.member ? { id: p.member.id, name: fullName(p.member) } : null,
    trainer: p.trainer.user.name,
    canEdit: c.isManager || p.trainerId === c.staffId,
    updatedAt: p.updatedAt.toISOString(),
    days: p.days.map((d) => ({ id: d.id, title: d.title, exercises: d.exercises })),
  };
}

async function insertPlan(tx: Tx, c: Coach, memberId: string | null, input: WorkoutPlanInput) {
  const id = createId();
  const gymId = c.ctx.gym.id;
  await tx.workoutPlan.create({
    data: {
      id,
      gymId,
      trainerId: c.staffId,
      memberId,
      title: input.title,
      notesEnc: encryptOptional(input.notes, notesCrypto(gymId, id)),
      status: input.status,
      days: { create: nestedDays(input.days) },
    },
    select: { id: true },
  });
  return id;
}

export async function createPlan(ctx: TenantContext, input: WorkoutPlanInput & { memberId: string | null }, meta: RequestMeta) {
  const c = coach(ctx);
  assertWritable(ctx);
  return inTenant(ctx, async (tx) => {
    if (input.memberId) await assertCanCoach(tx, c, input.memberId);
    const planId = await insertPlan(tx, c, input.memberId, input);
    await recordAudit(tx, ctx, { action: "workout_plan.create", entityType: "WorkoutPlan", entityId: planId, changes: { memberId: input.memberId, status: input.status, days: input.days.length } }, meta);
    return { planId };
  });
}

/**
 * Edit in place, matching days by position, so members keep the history of days they've done.
 * Exercises are replaced; days beyond the new count are removed (with their completions).
 */
export async function updatePlan(ctx: TenantContext, planId: string, input: WorkoutPlanInput, meta: RequestMeta) {
  const c = coach(ctx);
  assertWritable(ctx);
  return inTenant(ctx, async (tx) => {
    const plan = await tx.workoutPlan.findFirst({ where: { id: planId }, select: { id: true, trainerId: true, days: { select: { id: true, position: true } } } });
    if (!plan) throw new NotFoundError("Plan not found.");
    if (!c.isManager && plan.trainerId !== c.staffId) throw new ForbiddenError("Only the trainer who wrote this plan can change it.");
    const gymId = ctx.gym.id;
    await tx.workoutPlan.update({ where: { id: planId }, data: { title: input.title, status: input.status, notesEnc: encryptOptional(input.notes, notesCrypto(gymId, planId)) }, select: { id: true } });
    const byPosition = new Map(plan.days.map((d) => [d.position, d.id]));
    await tx.workoutPlanDay.deleteMany({ where: { planId, position: { gte: input.days.length } } });
    for (const [i, d] of input.days.entries()) {
      const existing = byPosition.get(i);
      if (existing) {
        await tx.workoutPlanDay.update({ where: { id: existing }, data: { title: d.title }, select: { id: true } });
        await tx.workoutExercise.deleteMany({ where: { dayId: existing } });
        await tx.workoutExercise.createMany({ data: d.exercises.map((e, j) => ({ ...exerciseData(e, j), gymId, dayId: existing })) });
      } else {
        await tx.workoutPlanDay.create({ data: { gymId, planId, position: i, title: d.title, exercises: { create: d.exercises.map(exerciseData) } }, select: { id: true } });
      }
    }
    await recordAudit(tx, ctx, { action: "workout_plan.update", entityType: "WorkoutPlan", entityId: planId, changes: { status: input.status, days: input.days.length } }, meta);
    return { planId };
  });
}

/** Copy a plan (usually a template) to a client as their active plan, written by me. */
export async function assignPlan(ctx: TenantContext, planId: string, memberId: string, meta: RequestMeta) {
  const c = coach(ctx);
  assertWritable(ctx);
  return inTenant(ctx, async (tx) => {
    await assertCanCoach(tx, c, memberId);
    const src = await tx.workoutPlan.findFirst({ where: { id: planId }, select: { title: true, notesEnc: true, days: { orderBy: { position: "asc" }, select: DAY_SELECT } } });
    if (!src) throw new NotFoundError("Plan not found.");
    const input: WorkoutPlanInput = {
      title: src.title,
      notes: tryDecrypt(src.notesEnc, notesCrypto(ctx.gym.id, planId)),
      status: "ACTIVE",
      days: src.days.map((d) => ({ title: d.title, exercises: d.exercises.map((e) => ({ name: e.name, sets: e.sets, reps: e.reps, restSeconds: e.restSeconds, notes: e.notes })) })),
    };
    const newId = await insertPlan(tx, c, memberId, input);
    await recordAudit(tx, ctx, { action: "workout_plan.assign", entityType: "WorkoutPlan", entityId: newId, changes: { from: planId, memberId } }, meta);
    return { planId: newId };
  });
}

// ─────────────────────────────── Member ───────────────────────────────

/** Active plans (RLS: only mine, only ACTIVE) with when I last did each day. */
export function memberWorkouts(ctx: MemberContext) {
  return inMember(ctx, async (tx) => {
    const plans = await tx.workoutPlan.findMany({
      where: { memberId: ctx.memberId, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, notesEnc: true, trainerId: true, days: { orderBy: { position: "asc" }, select: DAY_SELECT } },
    });
    const dayIds = plans.flatMap((p) => p.days.map((d) => d.id));
    const stats = await tx.workoutCompletion.groupBy({ by: ["dayId"], where: { memberId: ctx.memberId, dayId: { in: dayIds } }, _max: { completedAt: true }, _count: { _all: true } });
    const byDay = new Map(stats.map((s) => [s.dayId, s]));
    const recent = await tx.workoutCompletion.findMany({
      where: { memberId: ctx.memberId },
      orderBy: { completedAt: "desc" },
      take: 10,
      select: { id: true, completedAt: true, day: { select: { title: true, plan: { select: { title: true } } } } },
    });
    const thisWeek = await tx.workoutCompletion.count({ where: { memberId: ctx.memberId, completedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } });
    const trainerNames = await staffNamesForMember(tx, plans.map((p) => p.trainerId));
    return {
      plans: plans.map((p) => ({
        id: p.id,
        title: p.title,
        notes: tryDecrypt(p.notesEnc, notesCrypto(ctx.gym.id, p.id)),
        trainer: trainerNames.get(p.trainerId) ?? "Your trainer",
        days: p.days.map((d) => ({ id: d.id, title: d.title, exercises: d.exercises, lastCompletedAt: byDay.get(d.id)?._max.completedAt?.toISOString() ?? null, timesCompleted: byDay.get(d.id)?._count._all ?? 0 })),
      })),
      recent: recent.map((r) => ({ id: r.id, completedAt: r.completedAt.toISOString(), plan: r.day.plan.title, day: r.day.title })),
      thisWeek,
    };
  });
}

/** Members can't read staff records; member_staff_names() returns just the names they need. */
export async function staffNamesForMember(tx: Tx, staffIds: string[]) {
  const ids = [...new Set(staffIds)];
  if (!ids.length) return new Map<string, string>();
  const rows = await tx.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM member_staff_names(${ids}::text[])`;
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Mark a day as done. A second tap within 10 minutes returns the first, not a duplicate. */
export async function completeWorkout(ctx: MemberContext, dayId: string, note: string | null) {
  assertMemberWritable(ctx);
  return inMember(ctx, async (tx) => {
    const day = await tx.workoutPlanDay.findFirst({ where: { id: dayId }, select: { id: true } });
    if (!day) throw new NotFoundError("Workout not found.");
    const recent = await tx.workoutCompletion.findFirst({ where: { memberId: ctx.memberId, dayId, completedAt: { gte: new Date(Date.now() - 10 * 60_000) } }, select: { id: true, completedAt: true } });
    if (recent) return { completionId: recent.id, completedAt: recent.completedAt.toISOString() };
    const id = createId();
    const row = await tx.workoutCompletion.create({
      data: { id, gymId: ctx.gym.id, memberId: ctx.memberId, dayId, noteEnc: encryptOptional(note, completionCrypto(ctx.gym.id, id)) },
      select: { id: true, completedAt: true },
    });
    return { completionId: row.id, completedAt: row.completedAt.toISOString() };
  });
}

export function completionNote(gymId: string, id: string, noteEnc: string | null) {
  return tryDecrypt(noteEnc, completionCrypto(gymId, id));
}
