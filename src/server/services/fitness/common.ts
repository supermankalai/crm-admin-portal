import "server-only";
import { READ_ONLY_MESSAGES } from "@/domain/subscription-access";
import { ForbiddenError, GymReadOnlyError, NotFoundError } from "@/server/errors";
import type { Tx } from "@/server/db/context";
import { assertCan } from "@/server/tenant/guards";
import type { MemberContext } from "@/server/tenant/member";
import type { TenantContext } from "@/server/tenant/types";

/** Shared rules for trainer and member fitness features. */

export type Coach = { ctx: TenantContext; staffId: string; isManager: boolean };

/** Staff using trainer features: needs workouts.manage and a staff record (not support access). */
export function coach(ctx: TenantContext): Coach {
  assertCan(ctx, "workouts.manage");
  if (!ctx.staffId) throw new ForbiddenError("Only gym staff can do this.");
  return { ctx, staffId: ctx.staffId, isManager: ctx.role === "OWNER" || ctx.role === "MANAGER" };
}

export async function isTrainerOf(tx: Tx, c: Coach, memberId: string) {
  return !!(await tx.trainerClient.findFirst({ where: { trainerId: c.staffId, memberId }, select: { id: true } }));
}

/** Trainers work with their assigned clients; managers and owners with anyone in the gym. */
export async function assertCanCoach(tx: Tx, c: Coach, memberId: string) {
  const member = await tx.member.findFirst({ where: { id: memberId, deletedAt: null }, select: { id: true } });
  if (!member) throw new NotFoundError("Member not found.");
  if (!c.isManager && !(await isTrainerOf(tx, c, memberId))) throw new ForbiddenError("This member isn't one of your clients.");
}

/** Members can't change anything while their gym's app is paused (subscription read-only). */
export function assertMemberWritable(ctx: MemberContext) {
  if (!ctx.access.writable) throw new GymReadOnlyError(ctx.access.reason ? READ_ONLY_MESSAGES[ctx.access.reason] : undefined);
}

export const fullName = (m: { firstName: string; lastName: string }) => `${m.firstName} ${m.lastName}`;
