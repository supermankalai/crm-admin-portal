import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listMembershipPlans } from "@/server/services/membership-plans";
import { searchMembersForPicker } from "@/server/services/billing/queries";
import { suggestedStartDate } from "@/server/services/billing/sell";
import { todayFor } from "@/server/services/members/shared";
import { getMemberProfile } from "@/server/services/members/profile";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { SellForm } from "./sell-form";

export const metadata: Metadata = { title: "Sell membership" };

export default async function SellMembershipPage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<{ memberId?: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "payments.record")) return <AccessDenied what="selling memberships" />;
  if (!ctx.access.writable || ctx.supportSessionId) return <AccessDenied what="selling memberships while the gym is read-only" />;
  const plans = (await listMembershipPlans(ctx)).filter((p) => p.isActive);
  const memberId = (await searchParams).memberId;

  let initialMember = null;
  if (memberId) {
    const profile = await getMemberProfile(ctx, memberId).catch(() => null);
    if (profile) {
      const found = (await searchMembersForPicker(ctx, `M-${profile.member.memberNumber}`))[0];
      initialMember = found ?? null;
    }
  }
  const today = todayFor(ctx);
  const initialStart = initialMember ? await suggestedStartDate(ctx, initialMember.id) : today;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Sell membership" description="Creates the membership and its invoice together, with an optional payment now." />
      {plans.length === 0 ? (
        <Card>
          <EmptyState
            title="No plans on sale"
            description="Create a membership plan first."
            action={
              hasPermission(ctx, "plans.manage") && (
                <Button asChild>
                  <Link href={`/g/${ctx.gym.slug}/plans`}>Membership plans</Link>
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <SellForm
          gymSlug={ctx.gym.slug}
          plans={plans.map((p) => ({ id: p.id, name: p.name, type: p.type, priceMinor: p.priceMinor, durationDays: p.durationDays, classCredits: p.classCredits }))}
          currency={ctx.gym.currency}
          taxRateBps={ctx.gym.taxRateBps}
          today={today}
          initialMember={initialMember}
          initialStart={initialStart}
        />
      )}
    </div>
  );
}
