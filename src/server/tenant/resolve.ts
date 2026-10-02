import "server-only";
import { permissionsFor } from "@/domain/permissions";
import { computeSubscriptionAccess } from "@/domain/subscription-access";
import { SLUG_PATTERN } from "@/domain/slug";
import { withUser } from "@/server/db/context";
import type { TenantContext } from "./types";

type SessionUserLike = { id: string; name: string; email: string; isSuperAdmin: boolean };

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
      select: {
        id: true,
        role: true,
        gym: {
          select: {
            id: true,
            slug: true,
            name: true,
            status: true,
            timezone: true,
            currency: true,
            taxRateBps: true,
            brandColor: true,
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
          },
        },
      },
    })
  );
  if (!staff) return null;

  const { subscription, ...gym } = staff.gym;
  const plan = subscription?.plan;
  return {
    user,
    gym,
    staffId: staff.id,
    role: staff.role,
    permissions: new Set(permissionsFor(staff.role)),
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
    supportSessionId: null,
  };
}
