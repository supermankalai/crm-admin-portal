import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getSessionUser, requireUser } from "@/server/auth/session";
import { resolveTenant } from "./resolve";
import type { TenantContext } from "./types";

export type { TenantContext } from "./types";
export { assertCan, assertWritable, hasPermission, inTenant } from "./guards";

/**
 * Pages and layouts under /g/[gymSlug]: signed-in user who is active staff of this gym,
 * or 404. Cached per request, so the layout and the page share one lookup — but each page
 * still calls it itself (layouts are not re-run on client navigation).
 */
export const requireGymAccess = cache(async (gymSlug: string): Promise<TenantContext> => {
  const user = await requireUser();
  const ctx = await resolveTenant(user, gymSlug);
  if (!ctx) notFound();
  return ctx;
});

/** Route handlers and server actions: same check, but returns null instead of redirecting. */
export async function getGymAccess(gymSlug: string): Promise<TenantContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  return resolveTenant(user, gymSlug);
}
