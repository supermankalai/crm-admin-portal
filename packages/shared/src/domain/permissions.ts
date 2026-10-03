/**
 * Gym roles → permissions. The single source of truth for what each role may do inside a gym.
 * Checked on the server for every page, action and API route (UI hiding is cosmetic only).
 */

export type GymRole = "OWNER" | "MANAGER" | "FRONT_DESK" | "TRAINER";

export const PERMISSIONS = [
  "dashboard.view",
  "dashboard.financials",
  "members.view",
  "members.viewAll", // without it (trainers), only assigned clients are visible
  "members.create",
  "members.edit",
  "members.editContact",
  "members.delete",
  "members.notes",
  "plans.view",
  "plans.manage",
  "payments.view",
  "payments.record",
  "payments.refund",
  "checkin.perform",
  "classes.view",
  "classes.manage",
  "classes.manageOwn",
  "classes.book",
  "staff.view",
  "staff.manage",
  "staff.invite",
  "schedule.view",
  "reports.view",
  "reports.export",
  "notifications.view",
  "settings.manage",
  "billing.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

const MANAGER = new Set<Permission>([
  "dashboard.view",
  "dashboard.financials",
  "members.view",
  "members.viewAll",
  "members.create",
  "members.edit",
  "members.editContact",
  "members.delete",
  "members.notes",
  "plans.view",
  "plans.manage",
  "payments.view",
  "payments.record",
  "payments.refund",
  "checkin.perform",
  "classes.view",
  "classes.manage",
  "classes.manageOwn",
  "classes.book",
  "staff.view",
  "staff.invite",
  "schedule.view",
  "reports.view",
  "reports.export",
  "notifications.view",
]);

const FRONT_DESK = new Set<Permission>([
  "dashboard.view",
  "members.view",
  "members.viewAll",
  "members.create",
  "members.editContact",
  "plans.view",
  "payments.view",
  "payments.record",
  "checkin.perform",
  "classes.view",
  "classes.book",
  "schedule.view",
  "notifications.view",
]);

const TRAINER = new Set<Permission>([
  "dashboard.view",
  "members.view",
  "members.notes",
  "classes.view",
  "classes.manageOwn",
  "schedule.view",
  "notifications.view",
]);

const MATRIX: Record<GymRole, ReadonlySet<Permission>> = {
  OWNER: ALL,
  MANAGER,
  FRONT_DESK,
  TRAINER,
};

export function can(role: GymRole, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export function permissionsFor(role: GymRole): Permission[] {
  return PERMISSIONS.filter((p) => MATRIX[role].has(p));
}

/** Roles a staff member may invite or assign. Only owners can create managers or owners. */
export function assignableRoles(actor: GymRole): GymRole[] {
  if (actor === "OWNER") return ["OWNER", "MANAGER", "FRONT_DESK", "TRAINER"];
  if (actor === "MANAGER") return ["FRONT_DESK", "TRAINER"];
  return [];
}

export const ROLE_LABELS: Record<GymRole, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  FRONT_DESK: "Front desk",
  TRAINER: "Trainer",
};
