import "server-only";
import { logger } from "@/server/logger";
import { generateGymNotifications } from "@/server/notifications";
import { assertCan, assertWritable, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";

/**
 * A staff member's own notifications. RLS restricts every read and update to rows addressed to
 * the signed-in user, and these queries filter by recipient too.
 */

const PAGE_SIZE = 25;
const REFRESH_EVERY_MS = 10 * 60_000;
const lastRefresh = new Map<string, number>();

/**
 * Generate due alerts for this gym on demand (the scheduled job also does it). Throttled per gym
 * and serialised with an advisory lock; failures are logged, never shown to the user.
 */
export async function refreshNotifications(ctx: TenantContext, { force = false } = {}) {
  if (ctx.supportSessionId || !ctx.staffId || !ctx.access.writable) return;
  const last = lastRefresh.get(ctx.gym.id) ?? 0;
  if (!force && Date.now() - last < REFRESH_EVERY_MS) return;
  lastRefresh.set(ctx.gym.id, Date.now());
  try {
    await inTenant(ctx, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${ctx.gym.id}`}))`;
      await generateGymNotifications(tx, ctx.gym.id);
    });
  } catch (error) {
    logger.error("notification refresh failed", { gymId: ctx.gym.id, error });
  }
}

export async function unreadNotificationCount(ctx: TenantContext): Promise<number> {
  if (ctx.supportSessionId || !ctx.permissions.has("notifications.view")) return 0;
  return inTenant(ctx, (tx) => tx.notification.count({ where: { recipientUserId: ctx.user.id, readAt: null } }));
}

export async function listNotifications(ctx: TenantContext, opts: { unreadOnly: boolean; page: number }) {
  assertCan(ctx, "notifications.view");
  const where = { recipientUserId: ctx.user.id, ...(opts.unreadOnly ? { readAt: null } : {}) };
  return inTenant(ctx, async (tx) => {
    const total = await tx.notification.count({ where });
    const unread = opts.unreadOnly ? total : await tx.notification.count({ where: { recipientUserId: ctx.user.id, readAt: null } });
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(1, opts.page), pageCount);
    const rows = await tx.notification.findMany({
      where,
      orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, type: true, title: true, body: true, entityType: true, entityId: true, readAt: true, createdAt: true },
    });
    return { rows, total, unread, page, pageCount };
  });
}

export async function markNotificationRead(ctx: TenantContext, id: string) {
  assertCan(ctx, "notifications.view");
  assertWritable(ctx);
  return inTenant(ctx, async (tx) => {
    const n = await tx.notification.findFirst({ where: { id, recipientUserId: ctx.user.id }, select: { id: true, readAt: true, entityType: true, entityId: true } });
    if (!n) return null;
    if (!n.readAt) await tx.notification.updateMany({ where: { id, recipientUserId: ctx.user.id, readAt: null }, data: { readAt: new Date() } });
    return { href: await entityHref(tx, ctx, n.entityType, n.entityId) };
  });
}

export async function markAllNotificationsRead(ctx: TenantContext) {
  assertCan(ctx, "notifications.view");
  assertWritable(ctx);
  const r = await inTenant(ctx, (tx) => tx.notification.updateMany({ where: { recipientUserId: ctx.user.id, readAt: null }, data: { readAt: new Date() } }));
  return { marked: r.count };
}

/** Where a notification leads, if the user may open it. */
async function entityHref(tx: Parameters<Parameters<typeof inTenant>[1]>[0], ctx: TenantContext, entityType: string | null, entityId: string | null): Promise<string | null> {
  const base = `/g/${ctx.gym.slug}`;
  if (entityType === "Membership" && entityId && ctx.permissions.has("members.view")) {
    const ms = await tx.membership.findUnique({ where: { id: entityId }, select: { memberId: true } });
    return ms ? `${base}/members/${ms.memberId}` : null;
  }
  if (entityType === "Invoice" && entityId && ctx.permissions.has("payments.view")) return `${base}/invoices/${entityId}`;
  if ((entityType === "GymSubscription" || entityType === "PlatformPlan") && ctx.permissions.has("billing.manage")) return `${base}/billing`;
  return null;
}
