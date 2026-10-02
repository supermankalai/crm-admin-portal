import "server-only";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";

/** Headline facts for the gym home page. Every query runs in the gym's RLS context. */
export async function getGymOverview(ctx: TenantContext) {
  assertCan(ctx, "dashboard.view");
  return inTenant(ctx, async (tx) => {
    // Sequential: queries inside one transaction share a single connection.
    const members = await tx.member.count({ where: { deletedAt: null } });
    const staff = await tx.staffMember.count({ where: { status: "ACTIVE" } });
    const locations = await tx.location.count({ where: { isActive: true } });
    const staffByRole = await tx.staffMember.groupBy({ by: ["role"], where: { status: "ACTIVE" }, _count: { _all: true } });
    return {
      members,
      staff,
      locations,
      staffByRole: Object.fromEntries(staffByRole.map((r) => [r.role, r._count._all])) as Partial<Record<TenantContext["role"], number>>,
    };
  });
}
