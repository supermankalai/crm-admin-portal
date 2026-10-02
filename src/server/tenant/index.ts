import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { recordAudit } from "@/server/audit/tenant-audit";
import { getSessionUser, requireUser, type SessionUser } from "@/server/auth/session";
import { logger } from "@/server/logger";
import { metaFromHeaders } from "@/server/security/request-meta";
import { readSupportCookie } from "@/server/support/cookie";
import { inTenant } from "./guards";
import { resolveSupportTenant, resolveTenant } from "./resolve";
import type { TenantContext } from "./types";

export type { TenantContext } from "./types";
export { assertCan, assertWritable, hasPermission, inTenant } from "./guards";

async function resolveForUser(user: SessionUser, gymSlug: string): Promise<TenantContext | null> {
  const ctx = await resolveTenant(user, gymSlug);
  if (ctx || !user.isSuperAdmin) return ctx;
  const supportSessionId = await readSupportCookie();
  return supportSessionId ? resolveSupportTenant(user, gymSlug, supportSessionId) : null;
}

/** Every request made under support access is written to the gym's own audit log. */
async function logSupportView(ctx: TenantContext) {
  const h = await headers();
  try {
    await inTenant(ctx, (tx) =>
      recordAudit(tx, ctx, { action: "support.view", entityType: "Gym", entityId: ctx.gym.id, changes: { path: h.get("x-pathname") ?? "unknown" } }, metaFromHeaders(h))
    );
  } catch (error) {
    logger.error("support view audit failed", { error });
    throw error; // access is only allowed if it can be audited
  }
}

/**
 * Pages and layouts under /g/[gymSlug]: signed-in user who is active staff of this gym (or a
 * super admin with an open support session for it), or 404. Cached per request, so the layout
 * and the page share one lookup — but each page still calls it itself (layouts are not re-run
 * on client navigation).
 */
export const requireGymAccess = cache(async (gymSlug: string): Promise<TenantContext> => {
  const user = await requireUser();
  const ctx = await resolveForUser(user, gymSlug);
  if (!ctx) notFound();
  if (ctx.supportSessionId) await logSupportView(ctx);
  return ctx;
});

/** Route handlers and server actions: same check, but returns null instead of redirecting. */
export async function getGymAccess(gymSlug: string): Promise<TenantContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  return resolveForUser(user, gymSlug);
}
