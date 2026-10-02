"use server";

import { revalidatePath } from "next/cache";
import { membershipPlanSchema, planIdSchema } from "@/lib/validation/plans";
import { gymAction } from "@/server/actions/gym-action";
import { ValidationError } from "@/server/errors";
import { getRequestMeta } from "@/server/security/request-meta";
import { archiveMembershipPlan, createMembershipPlan, updateMembershipPlan } from "@/server/services/membership-plans";

export const saveMembershipPlanAction = gymAction({ permission: "plans.manage", schema: membershipPlanSchema, write: true }, async (ctx, input) => {
  const meta = await getRequestMeta();
  const result = input.planId ? await updateMembershipPlan(ctx, input.planId, input, meta) : await createMembershipPlan(ctx, input, meta);
  if (!result) throw new ValidationError("The plan could not be saved.");
  revalidatePath(`/g/${ctx.gym.slug}/plans`);
  return { id: result.id };
});

export const archiveMembershipPlanAction = gymAction({ permission: "plans.manage", schema: planIdSchema, write: true }, async (ctx, { planId }) => {
  await archiveMembershipPlan(ctx, planId, await getRequestMeta());
  revalidatePath(`/g/${ctx.gym.slug}/plans`);
  return { archived: true };
});
