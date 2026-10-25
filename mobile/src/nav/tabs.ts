import type { GymRole } from "@fitcrm/shared/api/schemas";

/**
 * Bottom tabs by role: each user sees only their own screens. Routes for other roles are not just
 * hidden but protected (Tabs.Protected), and the server checks every request regardless.
 */
export type TabKey = "dashboard" | "checkin" | "schedule" | "card" | "members" | "clients" | "classes" | "workouts" | "alerts" | "plans" | "progress" | "more";

export const TABS_BY_ROLE: Record<GymRole, readonly TabKey[]> = {
  OWNER: ["dashboard", "members", "classes", "alerts", "more"],
  MANAGER: ["dashboard", "members", "classes", "alerts", "more"],
  FRONT_DESK: ["checkin", "members", "classes", "more"],
  TRAINER: ["schedule", "clients", "classes", "plans", "more"],
  MEMBER: ["card", "classes", "workouts", "progress", "more"],
};

/**
 * Routes a role may open without a tab of their own: owners and managers reach the check-in
 * scanner from the dashboard.
 */
export const EXTRA_ROUTES_BY_ROLE: Partial<Record<GymRole, readonly TabKey[]>> = {
  OWNER: ["checkin"],
  MANAGER: ["checkin"],
};

/** Declaration order of the tab routes (the visible order follows it). */
export const ALL_TABS: readonly TabKey[] = ["dashboard", "checkin", "schedule", "card", "members", "clients", "classes", "workouts", "alerts", "plans", "progress", "more"];

export const TAB_META: Record<TabKey, { title: string; icon: string; iconActive: string }> = {
  dashboard: { title: "Dashboard", icon: "grid-outline", iconActive: "grid" },
  checkin: { title: "Check-in", icon: "scan-outline", iconActive: "scan" },
  schedule: { title: "Schedule", icon: "calendar-outline", iconActive: "calendar" },
  card: { title: "My card", icon: "card-outline", iconActive: "card" },
  members: { title: "Members", icon: "people-outline", iconActive: "people" },
  clients: { title: "Clients", icon: "people-outline", iconActive: "people" },
  classes: { title: "Classes", icon: "barbell-outline", iconActive: "barbell" },
  workouts: { title: "Workouts", icon: "fitness-outline", iconActive: "fitness" },
  alerts: { title: "Alerts", icon: "notifications-outline", iconActive: "notifications" },
  plans: { title: "Plans", icon: "clipboard-outline", iconActive: "clipboard" },
  progress: { title: "Progress", icon: "trending-up-outline", iconActive: "trending-up" },
  more: { title: "More", icon: "ellipsis-horizontal-circle-outline", iconActive: "ellipsis-horizontal-circle" },
};

export function tabsFor(role: GymRole | null | undefined): readonly TabKey[] {
  return role ? TABS_BY_ROLE[role] : [];
}

export function routesFor(role: GymRole | null | undefined): readonly TabKey[] {
  return role ? [...TABS_BY_ROLE[role], ...(EXTRA_ROUTES_BY_ROLE[role] ?? [])] : [];
}

export function homeTab(role: GymRole): TabKey {
  return TABS_BY_ROLE[role][0];
}
