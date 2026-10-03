import "server-only";
import { permissionsFor, type GymRole } from "@/domain/permissions";
import { computeSubscriptionAccess } from "@/domain/subscription-access";
import { SLUG_PATTERN } from "@/domain/slug";
import { withPlatformAdmin, withUser } from "@/server/db/context";
import type { TenantContext } from "./types";

type SessionUserLike = { id: string; name: string; email: string; isSuperAdmin: boolean };

const GYM_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  timezone: true,
  currency: true,
  taxRateBps: true,
  brandColor: true,
  logoFileId: true,
  subscription: {
    select: {
      status: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      plan: {
        select: {
          code: true,
          name: true,
          maxMembers: true,
          maxStaff: true,
          maxLocations: true,
          featureReports: true,
          featureCsvExport: true,
          featureClassBookings: true,
        },
      },
    },
  },
} as const;

type GymRow = {
  id: string;
  slug: string;
  name: string;
  status: TenantContext["gym"]["status"];
  timezone: string;
  currency: string;
  taxRateBps: number;
  brandColor: string;
  logoFileId: string | null;
  subscription: {
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "EXPIRED" | "CANCELLED";
    trialEndsAt: Date | null;
    currentPeriodEnd: Date;
    plan: {
      code: string;
      name: string;
      maxMembers: number;
      maxStaff: number;
      maxLocations: number;
      featureReports: boolean;
      featureCsvExport: boolean;
      featureClassBookings: boolean;
    };
  } | null;
};

function buildContext(
  user: SessionUserLike,
  row: GymRow,
  role: GymRole,
  staffId: string | null,
  supportSessionId: string | null,
  now: Date
): TenantContext {
  const { subscription, ...gym } = row;
  const plan = subscription?.plan;
  return {
    user,
    gym,
    staffId,
    role,
    permissions: new Set(permissionsFor(role)),
    plan: plan
      ? {
          code: plan.code,
          name: plan.name,
          maxMembers: plan.maxMembers,
          maxStaff: plan.maxStaff,
          maxLocations: plan.maxLocations,
          features: { reports: plan.featureReports, csvExport: plan.featureCsvExport, classBookings: plan.featureClassBookings },
        }
      : null,
    access: computeSubscriptionAccess(gym.status, subscription ?? null, now),
    supportSessionId,
  };
}

/**
 * Resolve /g/<slug> for a signed-in user. Returns null unless the user is ACTIVE staff of that
 * gym — callers respond with 404 so gym slugs cannot be probed. Runs in the user's RLS context,
 * so the database independently enforces the same rule.
 */
export async function resolveTenant(user: SessionUserLike, slug: string, now = new Date()): Promise<TenantContext | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const staff = await withUser(user.id, (tx) =>
    tx.staffMember.findFirst({
      where: { userId: user.id, status: "ACTIVE", gym: { slug } },
      select: { id: true, role: true, gym: { select: GYM_SELECT } },
    })
  );
  return staff ? buildContext(user, staff.gym, staff.role, staff.id, null, now) : null;
}

/**
 * Super admin support access: valid only for the admin who opened the session, for that one
 * gym, while it is open and unexpired. The context has full read permissions but is read-only
 * (assertWritable refuses, and RLS write policies require real staff membership).
 */
export async function resolveSupportTenant(
  user: SessionUserLike,
  slug: string,
  supportSessionId: string,
  now = new Date()
): Promise<TenantContext | null> {
  if (!user.isSuperAdmin || !SLUG_PATTERN.test(slug)) return null;
  const session = await withPlatformAdmin(user.id, (tx) =>
    tx.supportAccessSession.findFirst({
      where: { id: supportSessionId, superAdminId: user.id, endedAt: null, expiresAt: { gt: now }, gym: { slug } },
      select: { id: true, gym: { select: GYM_SELECT } },
    })
  );
  return session ? buildContext(user, session.gym, "OWNER", null, session.id, now) : null;
}
