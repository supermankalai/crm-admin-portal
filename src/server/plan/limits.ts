import "server-only";
import {
  checkLimit,
  featureMessage,
  limitMessage,
  type FeatureKey,
  type LimitKind,
  type PlanLimits,
} from "@/domain/plan-limits";
import type { Tx } from "@/server/db/context";
import { FeatureNotInPlanError, PlanLimitError } from "@/server/errors";
import { inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";

/** No plan means nothing is included (such gyms are read-only anyway). */
export function planLimitsOf(ctx: TenantContext): PlanLimits {
  const plan = ctx.plan;
  return plan
    ? { name: plan.name, maxMembers: plan.maxMembers, maxStaff: plan.maxStaff, maxLocations: plan.maxLocations, features: plan.features }
    : { name: "current", maxMembers: 0, maxStaff: 0, maxLocations: 0, features: { reports: false, csvExport: false, classBookings: false } };
}

export function hasFeature(ctx: TenantContext, feature: FeatureKey): boolean {
  return planLimitsOf(ctx).features[feature];
}

export function assertFeature(ctx: TenantContext, feature: FeatureKey): void {
  if (!hasFeature(ctx, feature)) throw new FeatureNotInPlanError(featureMessage(planLimitsOf(ctx), feature));
}

async function countUsage(tx: Tx, kind: LimitKind): Promise<number> {
  if (kind === "members") return tx.member.count({ where: { deletedAt: null } });
  if (kind === "staff") return tx.staffMember.count({ where: { status: "ACTIVE" } });
  return tx.location.count({ where: { isActive: true } });
}

/**
 * Friendly pre-check before creating members, staff or locations. The database trigger
 * (enforce_plan_limits) enforces the same limit atomically, including under concurrency.
 */
export async function assertWithinLimit(ctx: TenantContext, tx: Tx, kind: LimitKind, adding = 1): Promise<void> {
  const plan = planLimitsOf(ctx);
  const result = checkLimit(plan, kind, await countUsage(tx, kind), adding);
  if (!result.allowed) throw new PlanLimitError(limitMessage(plan, kind));
}

export async function getUsage(ctx: TenantContext) {
  const plan = planLimitsOf(ctx);
  return inTenant(ctx, async (tx) => {
    // Sequential: queries inside one transaction share a single connection.
    const members = await countUsage(tx, "members");
    const staff = await countUsage(tx, "staff");
    const locations = await countUsage(tx, "locations");
    return {
      members: checkLimit(plan, "members", members, 0),
      staff: checkLimit(plan, "staff", staff, 0),
      locations: checkLimit(plan, "locations", locations, 0),
    };
  });
}

/** Translate the database trigger's `plan_limit:<kind>` error into the friendly upgrade message. */
export function planLimitErrorFrom(error: unknown, ctx: TenantContext): PlanLimitError | null {
  const message = error instanceof Error ? error.message : "";
  const match = /plan_limit:(members|staff|locations)/.exec(message);
  return match ? new PlanLimitError(limitMessage(planLimitsOf(ctx), match[1] as LimitKind)) : null;
}
