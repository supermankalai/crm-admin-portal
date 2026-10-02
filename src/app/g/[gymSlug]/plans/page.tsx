import type { Metadata } from "next";
import { Tags } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, minorToMajorInput } from "@/domain/money";
import { listMembershipPlans } from "@/server/services/membership-plans";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { ArchivePlanButton } from "./archive-plan-button";
import { PlanDialog } from "./plan-dialog";

export const metadata: Metadata = { title: "Membership plans" };

const TYPE_LABELS: Record<string, string> = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", YEARLY: "Yearly", CLASS_PACK: "Class pack" };

export default async function PlansPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "plans.view")) return <AccessDenied what="membership plans" />;
  const plans = await listMembershipPlans(ctx);
  const canManage = hasPermission(ctx, "plans.manage") && ctx.access.writable && !ctx.supportSessionId;
  const money = (v: number) => formatMoney(v, ctx.gym.currency);

  return (
    <>
      <PageHeader
        title="Membership plans"
        description="What you sell: pricing, duration, freeze and cancellation rules."
        actions={canManage && <PlanDialog gymSlug={ctx.gym.slug} currency={ctx.gym.currency} />}
      />
      <Card className="gap-0 py-0">
        {plans.length === 0 ? (
          <EmptyState icon={<Tags />} title="No membership plans yet" description="Create your first plan, for example a monthly membership." action={canManage && <PlanDialog gymSlug={ctx.gym.slug} currency={ctx.gym.currency} />} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Plan</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Freezing</TableHead>
                <TableHead>Cancellation</TableHead>
                <TableHead>Members</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      {!p.isActive && <Badge variant="secondary">Not on sale</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {TYPE_LABELS[p.type]}
                      {p.description ? ` · ${p.description}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">{money(p.priceMinor)}</TableCell>
                  <TableCell className="text-sm">
                    {p.durationDays} days
                    {p.classCredits && <span className="block text-xs text-muted-foreground">{p.classCredits} classes</span>}
                  </TableCell>
                  <TableCell className="text-sm">{p.allowFreeze ? `Up to ${p.maxFreezeDays} days` : "Not allowed"}</TableCell>
                  <TableCell className="text-sm">
                    {p.cancellationNoticeDays ? `${p.cancellationNoticeDays} days' notice` : "Immediate"}
                    {p.cancellationFeeMinor > 0 && <span className="block text-xs text-muted-foreground">Fee {money(p.cancellationFeeMinor)}</span>}
                  </TableCell>
                  <TableCell className="tabular-nums">{p.activeMemberships}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <PlanDialog
                          gymSlug={ctx.gym.slug}
                          currency={ctx.gym.currency}
                          plan={{
                            planId: p.id,
                            name: p.name,
                            description: p.description ?? "",
                            type: p.type,
                            price: minorToMajorInput(p.priceMinor),
                            durationDays: p.durationDays,
                            classCredits: p.classCredits ?? "",
                            allowFreeze: p.allowFreeze,
                            maxFreezeDays: p.maxFreezeDays,
                            cancellationNoticeDays: p.cancellationNoticeDays,
                            cancellationFee: minorToMajorInput(p.cancellationFeeMinor),
                            isActive: p.isActive,
                          }}
                        />
                        <ArchivePlanButton gymSlug={ctx.gym.slug} planId={p.id} name={p.name} activeMemberships={p.activeMemberships} />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
