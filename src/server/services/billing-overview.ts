import "server-only";
import { getUsage } from "@/server/plan/limits";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";

/** Owner's view of their platform subscription: usage against limits and the change history. */
export async function getBillingOverview(ctx: TenantContext) {
  assertCan(ctx, "billing.manage");
  const [usage, history] = await Promise.all([
    getUsage(ctx),
    inTenant(ctx, async (tx) => {
      const rows = await tx.subscriptionHistory.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
      // Plan names for the history (PlatformPlan is public).
      const planIds = [...new Set(rows.flatMap((r) => [r.fromPlanId, r.toPlanId]).filter((v): v is string => !!v))];
      const plans = await tx.platformPlan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true } });
      const name = new Map(plans.map((p) => [p.id, p.name]));
      return rows.map((r) => ({ ...r, toPlanName: r.toPlanId ? name.get(r.toPlanId) ?? null : null }));
    }),
  ]);
  return { usage, history };
}
