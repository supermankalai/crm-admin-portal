"use server";

import { revalidatePath } from "next/cache";
import { resolveDeletionSchema } from "@/lib/validation/announcements";
import { gymAction } from "@/server/actions/gym-action";
import { getRequestMeta } from "@/server/security/request-meta";
import { completeDeletionRequest, rejectDeletionRequest } from "@/server/services/deletion-requests";

const refresh = (slug: string) => {
  revalidatePath(`/g/${slug}/deletion-requests`);
  revalidatePath(`/g/${slug}/members`);
};

export const completeDeletionAction = gymAction({ permission: "members.delete", schema: resolveDeletionSchema, write: true }, async (ctx, { requestId, note }) => {
  const r = await completeDeletionRequest(ctx, requestId, note, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});

export const rejectDeletionAction = gymAction({ permission: "members.delete", schema: resolveDeletionSchema, write: true }, async (ctx, { requestId, note }) => {
  const r = await rejectDeletionRequest(ctx, requestId, note, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});
