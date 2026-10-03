"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { brandingSchema, gymProfileSchema, locationSchema, openingHoursSchema } from "@/lib/validation/settings";
import { gymAction, type ActionResult } from "@/server/actions/gym-action";
import { getRequestMeta } from "@/server/security/request-meta";
import { removeGymLogo, saveLocation, saveOpeningHours, setGymLogo, updateBranding, updateGymProfile } from "@/server/services/settings";

// Settings affect every page of the gym (name, colour, time zone, currency), so refresh the layout.
const refresh = (slug: string) => revalidatePath(`/g/${slug}`, "layout");

export const updateGymProfileAction = gymAction({ permission: "settings.manage", schema: gymProfileSchema, write: true }, async (ctx, input) => {
  const r = await updateGymProfile(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});

export const saveOpeningHoursAction = gymAction({ permission: "settings.manage", schema: openingHoursSchema, write: true }, async (ctx, input) => {
  await saveOpeningHours(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug);
  return { saved: true };
});

export const saveLocationAction = gymAction({ permission: "settings.manage", schema: locationSchema, write: true }, async (ctx, input) => {
  const r = await saveLocation(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});

export const updateBrandingAction = gymAction({ permission: "settings.manage", schema: brandingSchema, write: true }, async (ctx, input) => {
  await updateBranding(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug);
  return { saved: true };
});

const logoSchema = z.object({ file: z.instanceof(File, { message: "Choose an image to upload" }) });

const uploadLogo = gymAction({ permission: "settings.manage", schema: logoSchema, write: true }, async (ctx, { file }) => {
  await setGymLogo(ctx, Buffer.from(await file.arrayBuffer()), await getRequestMeta());
  refresh(ctx.gym.slug);
  return { uploaded: true };
});

export async function uploadGymLogoAction(gymSlug: string, formData: FormData): Promise<ActionResult<{ uploaded: boolean }>> {
  return uploadLogo(gymSlug, { file: formData.get("file") });
}

export const removeGymLogoAction = gymAction({ permission: "settings.manage", schema: z.object({}), write: true }, async (ctx) => {
  await removeGymLogo(ctx, await getRequestMeta());
  refresh(ctx.gym.slug);
  return { removed: true };
});
