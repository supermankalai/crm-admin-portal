"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { localDateTime } from "@/domain/dates";
import { trainerNoteSchema } from "@/lib/validation/fitness";
import {
  assignTrainerSchema,
  bookPtSessionSchema,
  endAssignmentSchema,
  ptCreditsSettingSchema,
  ptPackageIdSchema,
  ptPackageSchema,
  ptSessionStatusSchema,
  sellPtPackageSchema,
  targetsFrom,
  updateGoalSchema,
} from "@/lib/validation/pt";
import { gymAction } from "@/server/actions/gym-action";
import { getRequestMeta } from "@/server/security/request-meta";
import { addTrainerNote } from "@/server/services/fitness/trainer";
import { assignTrainer, endAssignment, updateGoal } from "@/server/services/pt/assignments";
import { archivePackage, savePackage, sellPackage, setCreditsRequired } from "@/server/services/pt/packages";
import { bookSession, closeSession } from "@/server/services/pt/sessions";

/** The PT module's mutations. Each service re-checks who may do what; RLS checks it again. */

const refresh = (slug: string) => {
  revalidatePath(`/g/${slug}/pt`, "layout");
  revalidatePath(`/g/${slug}/staff`, "layout");
};

export const assignTrainerAction = gymAction({ permission: "pt.manage", schema: assignTrainerSchema, write: true }, async (ctx, input) => {
  const r = await assignTrainer(ctx, { memberId: input.memberId, trainerId: input.trainerId, goal: input.goal, targets: targetsFrom(input) }, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});

export const updateGoalAction = gymAction({ permission: "pt.manage", schema: updateGoalSchema, write: true }, async (ctx, input) => {
  const r = await updateGoal(ctx, { assignmentId: input.assignmentId, goal: input.goal, targets: targetsFrom(input) }, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});

export const endAssignmentAction = gymAction({ permission: "pt.manage", schema: endAssignmentSchema, write: true }, async (ctx, input) => {
  const r = await endAssignment(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});

export const bookPtSessionAction = gymAction({ permission: "workouts.manage", schema: bookPtSessionSchema, write: true }, async (ctx, input) => {
  const r = await bookSession(
    ctx,
    { trainerId: input.trainerId, memberId: input.memberId, startsAt: localDateTime(input.date, input.startTime, ctx.gym.timezone), durationMinutes: input.durationMinutes, focus: input.focus, complimentary: input.complimentary, deliveryMode: input.deliveryMode },
    await getRequestMeta()
  );
  refresh(ctx.gym.slug);
  revalidatePath(`/g/${ctx.gym.slug}/schedule`);
  return r;
});

export const ptSessionStatusAction = gymAction({ permission: "workouts.manage", schema: ptSessionStatusSchema, write: true }, async (ctx, input) => {
  const r = await closeSession(ctx, input.sessionId, input.status, await getRequestMeta());
  refresh(ctx.gym.slug);
  revalidatePath(`/g/${ctx.gym.slug}/schedule`);
  return r;
});

export const addPtNoteAction = gymAction({ permission: "workouts.manage", schema: trainerNoteSchema.extend({ memberId: z.string().trim().min(1).max(64) }), write: true }, async (ctx, input) => {
  const r = await addTrainerNote(ctx, input.memberId, input.body, await getRequestMeta());
  refresh(ctx.gym.slug);
  return { id: r.id };
});

// ─────────────────────────────── Packages ───────────────────────────────

export const savePtPackageAction = gymAction({ permission: "pt.manage", schema: ptPackageSchema, write: true }, async (ctx, input) => {
  const r = await savePackage(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});

export const archivePtPackageAction = gymAction({ permission: "pt.manage", schema: ptPackageIdSchema, write: true }, async (ctx, input) => {
  const r = await archivePackage(ctx, input.packageId, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});

export const setPtCreditsRequiredAction = gymAction({ permission: "settings.manage", schema: ptCreditsSettingSchema, write: true }, async (ctx, input) => {
  const r = await setCreditsRequired(ctx, input.required, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});

/** Sold from a PT client's page or the member's profile (front desk too). */
export const sellPtPackageAction = gymAction({ permission: "payments.record", schema: sellPtPackageSchema, write: true }, async (ctx, input) => {
  const r = await sellPackage(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug);
  revalidatePath(`/g/${ctx.gym.slug}/members/${input.memberId}`);
  revalidatePath(`/g/${ctx.gym.slug}/payments`, "layout");
  return r;
});
