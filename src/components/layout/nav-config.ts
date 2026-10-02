import type { Permission } from "@/domain/permissions";

/** Icons are referenced by name so the (server-filtered) nav can be passed to a client component. */
export type NavIcon =
  | "dashboard"
  | "members"
  | "checkin"
  | "payments"
  | "plans"
  | "classes"
  | "staff"
  | "schedule"
  | "reports"
  | "notifications"
  | "settings"
  | "audit"
  | "billing";

export type NavItem = { label: string; path: string; icon: NavIcon; permission: Permission };

/**
 * Gym navigation. Items are filtered on the server by the user's permissions; each target page
 * also checks the permission itself. Items are added here as their pages are built.
 */
export const GYM_NAV: NavItem[] = [
  { label: "Dashboard", path: "dashboard", icon: "dashboard", permission: "dashboard.view" },
  { label: "Plan & billing", path: "billing", icon: "billing", permission: "billing.manage" },
];
