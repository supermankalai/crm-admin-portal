"use server";

import { revalidatePath } from "next/cache";
import { assignPlanActionSchema, planStatusActionSchema, savePlanActionSchema } from "@/lib/validation/fitness";
import { gymAction } from "@/server/actions/gym-action";
import { getRequestMeta } from "@/server/security/request-meta";
import { assignPlan, createPlan, setPlanStatus, updatePlan } from "@/server/services/fitness/workouts";

const refresh = (slug: string, planId?: string) => {
  revalidatePath(`/g/${slug}/workouts`);
  if (planId) revalidatePath(`/g/${slug}/workouts/${planId}`);
};

export const savePlanAction = gymAction({ permission: "workouts.manage", schema: savePlanActionSchema, write: true }, async (ctx, { planId, memberId, ...plan }) => {
  const meta = await getRequestMeta();
  const r = planId ? await updatePlan(ctx, planId, plan, meta) : await createPlan(ctx, { ...plan, memberId: memberId ?? null }, meta);
  refresh(ctx.gym.slug, r.planId);
  return r;
});

export const setPlanStatusAction = gymAction({ permission: "workouts.manage", schema: planStatusActionSchema, write: true }, async (ctx, { planId, status }) => {
  const r = await setPlanStatus(ctx, planId, status, await getRequestMeta());
  refresh(ctx.gym.slug, planId);
  return r;
});

export const assignPlanAction = gymAction({ permission: "workouts.manage", schema: assignPlanActionSchema, write: true }, async (ctx, { planId, memberId }) => {
  const r = await assignPlan(ctx, planId, memberId, await getRequestMeta());
  refresh(ctx.gym.slug, r.planId);
  return r;
});
