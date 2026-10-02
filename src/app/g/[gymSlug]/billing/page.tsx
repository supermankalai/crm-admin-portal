import type { Metadata } from "next";
import { Check, X } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { SubscriptionStatusBadge } from "@/components/status-badges";
import { UpgradeNotice } from "@/components/upgrade-notice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FEATURE_LABELS, LIMIT_LABELS, limitMessage, usageLevel, type FeatureKey, type LimitKind } from "@/domain/plan-limits";
import { cn } from "@/lib/utils";
import { planLimitsOf } from "@/server/plan/limits";
import { getBillingOverview } from "@/server/services/billing-overview";
import { hasPermission, requireGymAccess } from "@/server/tenant";

export const metadata: Metadata = { title: "Plan & billing" };

const ACTION_LABEL: Record<string, string> = {
  TRIAL_STARTED: "Trial started",
  ACTIVATED: "Activated",
  EXTENDED: "Extended",
  PLAN_CHANGED: "Plan changed",
  SUSPENDED: "Suspended",
  REACTIVATED: "Reactivated",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export default async function BillingPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "billing.manage")) return <AccessDenied what="billing" />;
  const { usage, history } = await getBillingOverview(ctx);
  const plan = planLimitsOf(ctx);
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: ctx.gym.timezone }).format(d);
  const full = (Object.keys(usage) as LimitKind[]).filter((k) => !usage[k].allowed || usage[k].remaining === 0);

  return (
    <>
      <PageHeader title="Plan & billing" description="Your FitCRM subscription, what it includes, and how much of it you use." />

      {full.length > 0 && (
        <div className="mb-4 grid gap-2">
          {full.map((k) => (
            <UpgradeNotice key={k} message={limitMessage(plan, k)} canManageBilling />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{ctx.plan?.name ?? "No"} plan</CardTitle>
            <CardDescription>
              {ctx.access.endsAt ? `${ctx.access.isTrial ? "Trial ends" : "Current period ends"} ${fmt(ctx.access.endsAt)}` : "No active period"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div>{ctx.access.writable ? <Badge variant={ctx.access.isTrial ? "info" : "success"}>{ctx.access.isTrial ? "Free trial" : "Active"}</Badge> : <Badge variant="warning">Read-only</Badge>}</div>
            <ul className="grid gap-1.5 text-sm">
              {(Object.keys(FEATURE_LABELS) as FeatureKey[]).map((f) => (
                <li key={f} className={cn("flex items-center gap-2", !plan.features[f] && "text-muted-foreground")}>
                  {plan.features[f] ? <Check className="size-4 text-emerald-600" aria-hidden /> : <X className="size-4" aria-hidden />}
                  {FEATURE_LABELS[f]}
                  <span className="sr-only">{plan.features[f] ? "included" : "not included"}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Billing is handled by the FitCRM team. Contact them to upgrade or renew.</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>New members, staff or locations can&apos;t be added beyond your plan&apos;s limits.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {(Object.keys(usage) as LimitKind[]).map((k) => {
              const u = usage[k];
              const level = usageLevel(u.used, u.limit);
              const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 100;
              return (
                <div key={k} className="grid gap-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium first-letter:uppercase">{LIMIT_LABELS[k].plural}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {u.used.toLocaleString("en-IN")} of {u.limit.toLocaleString("en-IN")}
                      {level === "full" ? " · limit reached" : level === "near" ? " · almost full" : ""}
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-muted"
                    role="meter"
                    aria-label={`${LIMIT_LABELS[k].plural} used`}
                    aria-valuemin={0}
                    aria-valuemax={u.limit}
                    aria-valuenow={u.used}
                  >
                    <div
                      className={cn("h-full rounded-full", level === "full" ? "bg-red-500" : level === "near" ? "bg-amber-500" : "bg-[var(--chart-1)]")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 gap-0 py-0">
        <CardHeader className="py-5">
          <CardTitle>Subscription history</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period end</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((h) => (
              <TableRow key={h.id}>
                <TableCell>{fmt(h.createdAt)}</TableCell>
                <TableCell>{ACTION_LABEL[h.action] ?? h.action}</TableCell>
                <TableCell>{h.toPlanName ?? "—"}</TableCell>
                <TableCell>
                  <SubscriptionStatusBadge status={h.toStatus} />
                </TableCell>
                <TableCell>{h.newPeriodEnd ? fmt(h.newPeriodEnd) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
