import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { recordPlatformAudit } from "@/server/audit/platform-audit";
import { withPlatformAdmin } from "@/server/db/context";
import { NotFoundError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import type { PlanUpdateInput } from "@/lib/validation/platform";

/**
 * Super admin queries. Everything runs with the platform-admin RLS flag, which opens the
 * platform tables (gyms, subscriptions, plans, platform audit) but never tenant rows —
 * cross-gym numbers come only from the aggregate SECURITY DEFINER functions.
 */

export type PlatformStats = {
  gymsByStatus: Partial<Record<"TRIAL" | "ACTIVE" | "SUSPENDED" | "CANCELLED", number>>;
  gymsByPlan: { code: string; name: string; count: number }[];
  mrrMinor: number;
  trialsEndingSoon: number;
  totalMembers: number;
  activeMemberships: number;
  checkInsLast30Days: number;
  signupsByMonth: { month: string; count: number }[];
};

export function getPlatformStats(adminId: string): Promise<PlatformStats> {
  return withPlatformAdmin(adminId, async (tx) => {
    const [row] = await tx.$queryRaw<{ stats: PlatformStats }[]>`SELECT platform_stats() AS stats`;
    return row.stats;
  });
}

/** Mark ended trials/periods as EXPIRED (idempotent). Returns how many changed. */
export function expireDueSubscriptions(adminId: string): Promise<number> {
  return withPlatformAdmin(adminId, async (tx) => {
    const [row] = await tx.$queryRaw<{ n: number }[]>`SELECT expire_due_subscriptions() AS n`;
    return Number(row.n);
  });
}

export const GYM_PAGE_SIZE = 20;

export async function listGyms(adminId: string, filters: { q?: string; status?: string; page?: number }) {
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.GymWhereInput = {
    ...(filters.q ? { OR: [{ name: { contains: filters.q, mode: "insensitive" } }, { slug: { contains: filters.q.toLowerCase() } }] } : {}),
    ...(filters.status && ["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"].includes(filters.status)
      ? { status: filters.status as "TRIAL" | "ACTIVE" | "SUSPENDED" | "CANCELLED" }
      : {}),
  };
  return withPlatformAdmin(adminId, async (tx) => {
    // Queries inside one transaction share a connection, so they run sequentially.
    const total = await tx.gym.count({ where });
    const gyms = await tx.gym.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * GYM_PAGE_SIZE,
        take: GYM_PAGE_SIZE,
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          createdAt: true,
          subscription: { select: { status: true, currentPeriodEnd: true, trialEndsAt: true, plan: { select: { code: true, name: true, maxMembers: true } } } },
        },
      });
    const usage = await tx.$queryRaw<{ gym_id: string; members: bigint; staff: bigint; locations: bigint; check_ins_30d: bigint }[]>`
      SELECT * FROM platform_gym_usage()`;
    const usageById = new Map(usage.map((u) => [u.gym_id, u]));
    return {
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / GYM_PAGE_SIZE)),
      gyms: gyms.map((g) => {
        const u = usageById.get(g.id);
        return { ...g, members: Number(u?.members ?? 0), staff: Number(u?.staff ?? 0), checkIns30d: Number(u?.check_ins_30d ?? 0) };
      }),
    };
  });
}

export async function getGymDetail(adminId: string, gymId: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const gym = await tx.gym.findUnique({
      where: { id: gymId },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        email: true,
        phone: true,
        timezone: true,
        currency: true,
        createdAt: true,
        subscription: { include: { plan: true } },
        subscriptionHistory: { orderBy: { createdAt: "desc" }, take: 50 },
        supportSessions: { orderBy: { startedAt: "desc" }, take: 10, include: { superAdmin: { select: { name: true, email: true } } } },
      },
    });
    if (!gym) throw new NotFoundError("Gym not found.");
    const usage = await tx.$queryRaw<{ gym_id: string; members: bigint; staff: bigint; locations: bigint; check_ins_30d: bigint }[]>`
      SELECT * FROM platform_gym_usage() WHERE gym_id = ${gymId}`;
    const plans = await tx.platformPlan.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true, isActive: true } });
    const audit = await tx.platformAuditLog.findMany({ where: { gymId }, orderBy: { createdAt: "desc" }, take: 20 });
    const u = usage[0];
    return {
      gym,
      plans,
      audit,
      usage: { members: Number(u?.members ?? 0), staff: Number(u?.staff ?? 0), locations: Number(u?.locations ?? 0), checkIns30d: Number(u?.check_ins_30d ?? 0) },
    };
  });
}

export function listPlans(adminId: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const plans = await tx.platformPlan.findMany({ orderBy: { sortOrder: "asc" } });
    const counts = await tx.gymSubscription.groupBy({ by: ["planId"], _count: { _all: true } });
    const byPlan = new Map(counts.map((c) => [c.planId, c._count._all]));
    return plans.map((p) => ({ ...p, gymCount: byPlan.get(p.id) ?? 0 }));
  });
}

export function updatePlan(adminId: string, input: PlanUpdateInput, meta: RequestMeta) {
  return withPlatformAdmin(adminId, async (tx) => {
    const before = await tx.platformPlan.findUnique({ where: { code: input.code } });
    if (!before) throw new NotFoundError("Plan not found.");
    const { code, ...data } = input;
    const after = await tx.platformPlan.update({ where: { code }, data });
    const changes = Object.fromEntries(
      (Object.keys(data) as (keyof typeof data)[])
        .filter((k) => before[k] !== after[k])
        .map((k) => [k, { from: before[k], to: after[k] }])
    );
    await recordPlatformAudit(tx, { action: "plan.update", actorUserId: adminId, targetType: "PlatformPlan", targetId: code, metadata: { changes }, meta });
    return after;
  });
}

export const AUDIT_PAGE_SIZE = 50;

export function listPlatformAudit(adminId: string, filters: { action?: string; page?: number }) {
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.PlatformAuditLogWhereInput = filters.action ? { action: { startsWith: filters.action } } : {};
  return withPlatformAdmin(adminId, async (tx) => {
    const total = await tx.platformAuditLog.count({ where });
    const rows = await tx.platformAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE });
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => !!v))];
    const gymIds = [...new Set(rows.map((r) => r.gymId).filter((v): v is string => !!v))];
    // Platform admins may read user names/emails for the audit trail.
    const actors = await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } });
    const gyms = await tx.gym.findMany({ where: { id: { in: gymIds } }, select: { id: true, slug: true } });
    const actorById = new Map(actors.map((a) => [a.id, a]));
    const gymById = new Map(gyms.map((g) => [g.id, g.slug]));
    return {
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
      rows: rows.map((r) => ({ ...r, actor: r.actorUserId ? actorById.get(r.actorUserId) ?? null : null, gymSlug: r.gymId ? gymById.get(r.gymId) ?? null : null })),
    };
  });
}

export async function listSupportSessions(adminId: string, now = new Date()) {
  const sessions = await withPlatformAdmin(adminId, (tx) =>
    tx.supportAccessSession.findMany({
      orderBy: { startedAt: "desc" },
      take: 100,
      include: { gym: { select: { slug: true, name: true } }, superAdmin: { select: { name: true, email: true } } },
    })
  );
  return sessions.map((s) => ({ ...s, isActive: !s.endedAt && s.expiresAt.getTime() > now.getTime() }));
}
