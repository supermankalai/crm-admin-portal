"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { gymAction } from "@/server/actions/gym-action";
import { markAllNotificationsRead, markNotificationRead } from "@/server/services/notifications";

const refresh = (slug: string) => revalidatePath(`/g/${slug}`, "layout"); // the bell count lives in the layout

export const openNotificationAction = gymAction(
  { permission: "notifications.view", schema: z.object({ notificationId: z.string().min(1).max(64) }), write: true },
  async (ctx, { notificationId }) => {
    const r = await markNotificationRead(ctx, notificationId);
    refresh(ctx.gym.slug);
    return { href: r?.href ?? null };
  }
);

export const markAllReadAction = gymAction({ permission: "notifications.view", schema: z.object({}), write: true }, async (ctx) => {
  const r = await markAllNotificationsRead(ctx);
  refresh(ctx.gym.slug);
  return r;
});
