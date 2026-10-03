"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  cancelMembershipSchema,
  freezeSchema,
  memberIdSchema,
  memberNoteSchema,
  memberSchema,
  membershipIdSchema,
} from "@/lib/validation/members";
import { gymAction, type ActionResult } from "@/server/actions/gym-action";
import { getRequestMeta } from "@/server/security/request-meta";
import { addMemberNote, createMember, setMemberPhoto, softDeleteMember, updateMember } from "@/server/services/members/commands";
import { cancelMembership, freezeMembership, unfreezeMembership } from "@/server/services/members/memberships";

const refresh = (slug: string, memberId?: string) => {
  revalidatePath(`/g/${slug}/members`);
  if (memberId) revalidatePath(`/g/${slug}/members/${memberId}`);
  revalidatePath(`/g/${slug}/dashboard`);
};

export const createMemberAction = gymAction({ permission: "members.create", schema: memberSchema, write: true }, async (ctx, input) => {
  const result = await createMember(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug);
  return result;
});

/** Partial: front desk sends only contact fields; the service refuses anything else for them. */
const memberUpdatePayload = memberSchema.partial().extend({ memberId: z.string().min(1).max(64) });

export const updateMemberAction = gymAction({ permission: "members.editContact", schema: memberUpdatePayload, write: true }, async (ctx, input) => {
  const { memberId, ...fields } = input;
  const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const result = await updateMember(ctx, memberId, defined, await getRequestMeta());
  refresh(ctx.gym.slug, memberId);
  return result;
});

export const deleteMemberAction = gymAction({ permission: "members.delete", schema: memberIdSchema, write: true }, async (ctx, { memberId }) => {
  await softDeleteMember(ctx, memberId, await getRequestMeta());
  refresh(ctx.gym.slug);
  return { deleted: true };
});

export const addNoteAction = gymAction({ permission: "members.notes", schema: memberNoteSchema, write: true }, async (ctx, { memberId, body }) => {
  const result = await addMemberNote(ctx, memberId, body, await getRequestMeta());
  refresh(ctx.gym.slug, memberId);
  return result;
});

export const freezeMembershipAction = gymAction({ permission: "members.edit", schema: freezeSchema.extend({ memberId: z.string().min(1).max(64) }), write: true }, async (ctx, input) => {
  const result = await freezeMembership(ctx, input.membershipId, input.days, await getRequestMeta());
  refresh(ctx.gym.slug, input.memberId);
  return result;
});

export const unfreezeMembershipAction = gymAction({ permission: "members.edit", schema: membershipIdSchema.extend({ memberId: z.string().min(1).max(64) }), write: true }, async (ctx, input) => {
  const result = await unfreezeMembership(ctx, input.membershipId, await getRequestMeta());
  refresh(ctx.gym.slug, input.memberId);
  return { newEndDate: result.newEndDate };
});

export const cancelMembershipAction = gymAction({ permission: "members.edit", schema: cancelMembershipSchema.extend({ memberId: z.string().min(1).max(64) }), write: true }, async (ctx, input) => {
  const result = await cancelMembership(ctx, input.membershipId, input.reason, await getRequestMeta());
  refresh(ctx.gym.slug, input.memberId);
  return result;
});

const photoSchema = z.object({
  memberId: z.string().min(1).max(64),
  file: z.instanceof(File, { message: "Choose an image to upload" }),
});

const uploadPhoto = gymAction({ permission: "members.editContact", schema: photoSchema, write: true }, async (ctx, { memberId, file }) => {
  await setMemberPhoto(ctx, memberId, Buffer.from(await file.arrayBuffer()), await getRequestMeta());
  refresh(ctx.gym.slug, memberId);
  return { uploaded: true };
});

export async function uploadMemberPhotoAction(gymSlug: string, formData: FormData): Promise<ActionResult<{ uploaded: boolean }>> {
  return uploadPhoto(gymSlug, { memberId: formData.get("memberId"), file: formData.get("file") });
}
