"use server";

import { revalidatePath } from "next/cache";
import { announcementIdSchema, announcementSchema } from "@/lib/validation/announcements";
import { gymAction } from "@/server/actions/gym-action";
import { getRequestMeta } from "@/server/security/request-meta";
import { deleteAnnouncement, publishAnnouncement } from "@/server/services/announcements";

export const publishAnnouncementAction = gymAction({ permission: "announcements.manage", schema: announcementSchema, write: true }, async (ctx, input) => {
  const r = await publishAnnouncement(ctx, input, await getRequestMeta());
  revalidatePath(`/g/${ctx.gym.slug}/announcements`);
  return r;
});

export const deleteAnnouncementAction = gymAction({ permission: "announcements.manage", schema: announcementIdSchema, write: true }, async (ctx, { announcementId }) => {
  const r = await deleteAnnouncement(ctx, announcementId, await getRequestMeta());
  revalidatePath(`/g/${ctx.gym.slug}/announcements`);
  return r;
});
