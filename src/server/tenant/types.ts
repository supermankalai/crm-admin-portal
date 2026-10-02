import type { GymRole, Permission } from "@/domain/permissions";
import type { GymStatus, SubscriptionAccess } from "@/domain/subscription-access";

export type PlanSummary = {
  code: string;
  name: string;
  maxMembers: number;
  maxStaff: number;
  maxLocations: number;
  features: { reports: boolean; csvExport: boolean; classBookings: boolean };
};

/**
 * Everything a request inside /g/[gymSlug] may rely on. Built only by resolveTenant() from
 * the authenticated session + a database membership check — never from request input.
 */
export type TenantContext = {
  user: { id: string; name: string; email: string; isSuperAdmin: boolean };
  gym: {
    id: string;
    slug: string;
    name: string;
    status: GymStatus;
    timezone: string;
    currency: string;
    taxRateBps: number;
    brandColor: string;
  };
  /** Null for super admin support access (not a staff member). */
  staffId: string | null;
  role: GymRole;
  permissions: ReadonlySet<Permission>;
  plan: PlanSummary | null;
  access: SubscriptionAccess;
  /** Set only for super admin support access (Phase 3); such contexts are read-only. */
  supportSessionId: string | null;
};
