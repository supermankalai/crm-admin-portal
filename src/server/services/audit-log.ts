import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { dayBounds, isDateString } from "@/domain/dates";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";

/**
 * The gym's audit trail (owner only). Rows are append-only in the database; this is read-only.
 * Values that were personal data were redacted when the entry was written.
 */

export const AUDIT_CATEGORIES = [
  { key: "member", label: "Members", prefixes: ["member."] },
  { key: "membership", label: "Memberships", prefixes: ["membership."] },
  { key: "money", label: "Payments & invoices", prefixes: ["payment.", "invoice.", "refund."] },
  { key: "checkin", label: "Check-ins", prefixes: ["checkin."] },
  { key: "classes", label: "Classes & bookings", prefixes: ["class.", "class_type.", "room.", "booking."] },
  { key: "staff", label: "Staff & shifts", prefixes: ["staff.", "shift."] },
  { key: "plans", label: "Membership plans", prefixes: ["plan."] },
  { key: "settings", label: "Settings & locations", prefixes: ["settings.", "location."] },
  { key: "reports", label: "Report exports", prefixes: ["report."] },
  { key: "support", label: "Support access", prefixes: ["support."] },
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]["key"];

const PAGE_SIZE = 50;

export async function listAuditLog(
  ctx: TenantContext,
  opts: { category?: string; actorUserId?: string; from?: string; to?: string; page: number }
) {
  assertCan(ctx, "audit.view");
  const tz = ctx.gym.timezone;
  const category = AUDIT_CATEGORIES.find((c) => c.key === opts.category);
  const where: Prisma.AuditLogWhereInput = {
    ...(category ? { OR: category.prefixes.map((p) => ({ action: { startsWith: p } })) } : {}),
    ...(opts.actorUserId ? { actorUserId: opts.actorUserId } : {}),
    ...(opts.from && isDateString(opts.from) ? { createdAt: { gte: dayBounds(opts.from, tz).start } } : {}),
  };
  if (opts.to && isDateString(opts.to)) where.createdAt = { ...(where.createdAt as object), lt: dayBounds(opts.to, tz).end };

  return inTenant(ctx, async (tx) => {
    const total = await tx.auditLog.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(1, opts.page), pageCount);
    const rows = await tx.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, action: true, entityType: true, entityId: true, actorUserId: true, actorType: true, changes: true, ip: true, createdAt: true },
    });

    // Names of everyone who has worked here (including removed staff), for the actor column and filter.
    const people = await tx.staffMember.findMany({ select: { userId: true, status: true, user: { select: { name: true, email: true } } }, orderBy: { user: { name: "asc" } } });
    const byId = new Map(people.map((p) => [p.userId, p.user]));
    return {
      rows: rows.map((r) => ({
        ...r,
        actor: r.actorType === "SUPPORT" ? { name: "Platform support", email: null } : r.actorUserId ? (byId.get(r.actorUserId) ?? { name: "Former user", email: null }) : { name: "System", email: null },
      })),
      people: people.map((p) => ({ userId: p.userId, name: p.user.name, removed: p.status !== "ACTIVE" })),
      total,
      page,
      pageCount,
    };
  });
}

/** "member.photo_update" → "Member photo update". */
export function describeAction(action: string): string {
  const text = action.replace(/[._]/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
