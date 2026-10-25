"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { gymAction } from "@/server/actions/gym-action";
import { markAllNotificationsRead, markNotificationRead } from "@/server/services/notifications";

// Marking alerts read changes nothing about the gym's data, so it works in read-only gyms too
// (write: false); the service still refuses support access.
const refresh = (slug: string) => revalidatePath(`/g/${slug}`, "layout"); // the bell count lives in the layout

export const openNotificationAction = gymAction(
  { permission: "notifications.view", schema: z.object({ notificationId: z.string().min(1).max(64) }), write: false },
  async (ctx, { notificationId }) => {
    const r = await markNotificationRead(ctx, notificationId);
    refresh(ctx.gym.slug);
    return { href: r?.href ?? null };
  }
);

export const markAllReadAction = gymAction({ permission: "notifications.view", schema: z.object({}), write: false }, async (ctx) => {
  const r = await markAllNotificationsRead(ctx);
  refresh(ctx.gym.slug);
  return r;
});
