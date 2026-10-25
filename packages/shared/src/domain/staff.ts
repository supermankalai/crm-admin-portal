import { assignableRoles, type GymRole } from "./permissions";

/** Staff management rules: who may change whose role, and the last-owner guard. */

export class StaffRuleError extends Error {}

export function assertCanChangeRole(actor: GymRole, target: { role: GymRole; isSelf: boolean }, newRole: GymRole, activeOwners: number) {
  if (target.role === newRole) throw new StaffRuleError("They already have this role.");
  if (actor !== "OWNER") throw new StaffRuleError("Only the gym owner can change roles.");
  if (!assignableRoles(actor).includes(newRole)) throw new StaffRuleError("You can't assign that role.");
  if (target.role === "OWNER" && activeOwners <= 1) throw new StaffRuleError("A gym must always have at least one owner. Make someone else an owner first.");
}

export function assertCanRemove(actor: GymRole, target: { role: GymRole; isSelf: boolean }, activeOwners: number) {
  if (actor !== "OWNER") throw new StaffRuleError("Only the gym owner can remove staff.");
  if (target.role === "OWNER" && activeOwners <= 1) throw new StaffRuleError("You can't remove the last owner of the gym.");
}

export function assertCanInvite(actor: GymRole, role: GymRole) {
  if (!assignableRoles(actor).includes(role)) {
    throw new StaffRuleError(actor === "MANAGER" ? "Managers can invite front desk staff and trainers only." : "You can't invite staff.");
  }
}

export const INVITATION_DAYS = 7;
