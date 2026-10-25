import type { Metadata } from "next";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { MemberForm } from "@/components/members/member-form";
import { UpgradeNotice } from "@/components/upgrade-notice";
import { limitMessage } from "@/domain/plan-limits";
import { getUsage, planLimitsOf } from "@/server/plan/limits";
import { hasPermission, requireGymAccess } from "@/server/tenant";

export const metadata: Metadata = { title: "Add member" };

export default async function NewMemberPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "members.create")) return <AccessDenied what="adding members" />;
  if (!ctx.access.writable || ctx.supportSessionId) return <AccessDenied what="adding members while the gym is read-only" />;
  const usage = await getUsage(ctx);
  const canManageBilling = hasPermission(ctx, "billing.manage");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add member"
        description={`${usage.members.used.toLocaleString("en-IN")} of ${usage.members.limit.toLocaleString("en-IN")} members on your ${ctx.plan?.name ?? ""} plan.`}
      />
      {usage.members.remaining === 0 ? (
        <UpgradeNotice message={limitMessage(planLimitsOf(ctx), "members")} canManageBilling={canManageBilling} />
      ) : (
        <MemberForm gymSlug={ctx.gym.slug} mode={{ kind: "create" }} canManageBilling={canManageBilling} />
      )}
    </div>
  );
}
