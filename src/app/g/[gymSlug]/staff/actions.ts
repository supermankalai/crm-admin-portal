"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { clientAssignmentSchema, inviteSchema, revokeInviteSchema, roleChangeSchema, shiftIdSchema, shiftSchema, staffIdSchema, staffProfileSchema } from "@/lib/validation/staff";
import { gymAction } from "@/server/actions/gym-action";
import { getRequestMeta } from "@/server/security/request-meta";
import { addShift, assignClient, changeStaffRole, deleteShift, inviteStaff, removeStaff, revokeInvitation, updateStaffProfile } from "@/server/services/staff";

const refresh = (slug: string, staffId?: string) => {
  revalidatePath(`/g/${slug}/staff`);
  revalidatePath(`/g/${slug}/schedule`);
  if (staffId) revalidatePath(`/g/${slug}/staff/${staffId}`);
};

export const inviteStaffAction = gymAction({ permission: "staff.invite", schema: inviteSchema, write: true }, async (ctx, input) => {
  const r = await inviteStaff(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});

export const revokeInvitationAction = gymAction({ permission: "staff.invite", schema: revokeInviteSchema, write: true }, async (ctx, input) => {
  await revokeInvitation(ctx, input.invitationId, await getRequestMeta());
  refresh(ctx.gym.slug);
  return { revoked: true };
});

export const changeRoleAction = gymAction({ permission: "staff.manage", schema: roleChangeSchema, write: true }, async (ctx, input) => {
  await changeStaffRole(ctx, input.staffId, input.role, await getRequestMeta());
  refresh(ctx.gym.slug, input.staffId);
  return { role: input.role };
});

export const removeStaffAction = gymAction({ permission: "staff.manage", schema: staffIdSchema, write: true }, async (ctx, input) => {
  const r = await removeStaff(ctx, input.staffId, await getRequestMeta());
  refresh(ctx.gym.slug, input.staffId);
  return r;
});

/** Own profile or (owner/manager) anyone's — checked in the service. */
export const updateStaffProfileAction = gymAction({ permission: "schedule.view", schema: staffProfileSchema, write: true }, async (ctx, input) => {
  await updateStaffProfile(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug, input.staffId);
  return { saved: true };
});

export const assignClientAction = gymAction({ permission: "staff.invite", schema: clientAssignmentSchema.extend({ assign: z.boolean() }), write: true }, async (ctx, input) => {
  await assignClient(ctx, input.staffId, input.memberId, input.assign, await getRequestMeta());
  refresh(ctx.gym.slug, input.staffId);
  return { assigned: input.assign };
});

export const addShiftAction = gymAction({ permission: "staff.invite", schema: shiftSchema, write: true }, async (ctx, input) => {
  const r = await addShift(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug, input.staffId);
  return r;
});

export const deleteShiftAction = gymAction({ permission: "staff.invite", schema: shiftIdSchema.extend({ staffId: z.string().min(1).max(64) }), write: true }, async (ctx, input) => {
  await deleteShift(ctx, input.shiftId, await getRequestMeta());
  refresh(ctx.gym.slug, input.staffId);
  return { deleted: true };
});
