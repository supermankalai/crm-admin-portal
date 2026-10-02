import "server-only";
import { fromDateString, localDate } from "@/domain/dates";
import { recordAudit } from "@/server/audit/tenant-audit";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import type { MembershipPlanInput } from "@/lib/validation/plans";

const NAME_TAKEN = "A plan with this name already exists.";

export async function listMembershipPlans(ctx: TenantContext, { includeArchived = false } = {}) {
  assertCan(ctx, "plans.view");
  return inTenant(ctx, async (tx) => {
    const plans = await tx.membershipPlan.findMany({
      where: includeArchived ? {} : { deletedAt: null },
      orderBy: [{ deletedAt: { sort: "desc", nulls: "first" } }, { isActive: "desc" }, { priceMinor: "asc" }],
    });
    const today = fromDateString(localDate(new Date(), ctx.gym.timezone));
    const usage = await tx.membership.groupBy({
      by: ["planId"],
      where: { endDate: { gte: today }, status: { in: ["ACTIVE", "FROZEN"] } },
      _count: { _all: true },
    });
    const activeByPlan = new Map(usage.map((u) => [u.planId, u._count._all]));
    return plans.map((p) => ({ ...p, activeMemberships: activeByPlan.get(p.id) ?? 0 }));
  });
}

function planData(input: MembershipPlanInput) {
  return {
    name: input.name,
    description: input.description,
    type: input.type,
    priceMinor: input.price,
    durationDays: input.durationDays,
    classCredits: input.classCredits,
    allowFreeze: input.allowFreeze,
    maxFreezeDays: input.maxFreezeDays,
    cancellationNoticeDays: input.cancellationNoticeDays,
    cancellationFeeMinor: input.cancellationFee,
    isActive: input.isActive,
  };
}

function mapNameConflict(error: unknown): never {
  if (error instanceof Error && error.message.includes("nameKey")) throw new ValidationError(NAME_TAKEN, { name: [NAME_TAKEN] });
  throw error;
}

export async function createMembershipPlan(ctx: TenantContext, input: MembershipPlanInput, meta: RequestMeta) {
  assertCan(ctx, "plans.manage");
  try {
    return await inTenant(ctx, async (tx) => {
      const plan = await tx.membershipPlan.create({ data: { gymId: ctx.gym.id, ...planData(input) }, select: { id: true } });
      await recordAudit(tx, ctx, { action: "plan.create", entityType: "MembershipPlan", entityId: plan.id, changes: planData(input) }, meta);
      return plan;
    });
  } catch (error) {
    mapNameConflict(error);
  }
}

/**
 * Editing a plan changes it for future sales only: existing memberships keep the price they
 * were sold at (Membership.priceMinor is a snapshot).
 */
export async function updateMembershipPlan(ctx: TenantContext, planId: string, input: MembershipPlanInput, meta: RequestMeta) {
  assertCan(ctx, "plans.manage");
  try {
    return await inTenant(ctx, async (tx) => {
      const before = await tx.membershipPlan.findFirst({ where: { id: planId, deletedAt: null } });
      if (!before) throw new NotFoundError("Plan not found.");
      const data = planData(input);
      await tx.membershipPlan.update({ where: { id: planId }, data, select: { id: true } });
      const changes = Object.fromEntries(
        (Object.keys(data) as (keyof typeof data)[]).filter((k) => before[k] !== data[k]).map((k) => [k, { from: before[k], to: data[k] }])
      );
      await recordAudit(tx, ctx, { action: "plan.update", entityType: "MembershipPlan", entityId: planId, changes }, meta);
      return { id: planId };
    });
  } catch (error) {
    mapNameConflict(error);
  }
}

/** Archive (soft delete). Existing memberships on the plan are unaffected. */
export async function archiveMembershipPlan(ctx: TenantContext, planId: string, meta: RequestMeta) {
  assertCan(ctx, "plans.manage");
  return inTenant(ctx, async (tx) => {
    const plan = await tx.membershipPlan.findFirst({ where: { id: planId, deletedAt: null }, select: { id: true, name: true } });
    if (!plan) throw new NotFoundError("Plan not found.");
    await tx.membershipPlan.update({ where: { id: planId }, data: { deletedAt: new Date(), isActive: false }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "plan.archive", entityType: "MembershipPlan", entityId: planId, changes: { name: plan.name } }, meta);
  });
}
