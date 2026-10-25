import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { BarChart } from "@/components/charts/bar-chart";
import { Heatmap } from "@/components/charts/heatmap";
import { LineChart } from "@/components/charts/line-chart";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { LinkTabs } from "@/components/link-tabs";
import { StatTile } from "@/components/stat-tile";
import { UpgradeNotice } from "@/components/upgrade-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/domain/money";
import { featureMessage } from "@/domain/plan-limits";
import { activeHourSpan, busiestSlot, hourLabel, REPORT_KINDS, REPORT_LABELS, resolveRange, type DateRange, type ReportKind } from "@/domain/reports";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/payments";
import { cn } from "@/lib/utils";
import { hasFeature, planLimitsOf } from "@/server/plan/limits";
import { todayFor } from "@/server/services/members/shared";
import { attendanceReport, classReport, describeRange, rangePresets, retentionReport, revenueReport } from "@/server/services/reports";
import { hasPermission, requireGymAccess, type TenantContext } from "@/server/tenant";

export const metadata: Metadata = { title: "Reports" };

type Search = { tab?: string; from?: string; to?: string };

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<Search> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "reports.view")) return <AccessDenied what="reports" />;
  const sp = await searchParams;
  const base = `/g/${ctx.gym.slug}/reports`;

  if (!hasFeature(ctx, "reports")) {
    return (
      <>
        <PageHeader title="Reports" description="Revenue, attendance, retention and class popularity." />
        <UpgradeNotice message={featureMessage(planLimitsOf(ctx), "reports")} canManageBilling={hasPermission(ctx, "billing.manage")} />
      </>
    );
  }

  const tab: ReportKind = (REPORT_KINDS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as ReportKind) : "revenue";
  const range = resolveRange(sp.from, sp.to, todayFor(ctx));
  const qs = (t: ReportKind, r: DateRange = range) => `${base}?tab=${t}&from=${r.from}&to=${r.to}`;
  const canExport = hasPermission(ctx, "reports.export");
  const exportAllowed = canExport && hasFeature(ctx, "csvExport");

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${describeRange(range)} · times in ${ctx.gym.timezone}`}
        actions={
          canExport &&
          (exportAllowed ? (
            <Button asChild variant="outline">
              <a href={`/api/g/${ctx.gym.slug}/reports/${tab}?from=${range.from}&to=${range.to}`} download>
                <Download aria-hidden /> Export CSV
              </a>
            </Button>
          ) : (
            <Button variant="outline" disabled title={featureMessage(planLimitsOf(ctx), "csvExport")}>
              <Download aria-hidden /> Export CSV
            </Button>
          ))
        }
      />
      {canExport && !exportAllowed && (
        <div className="mb-4">
          <UpgradeNotice message={featureMessage(planLimitsOf(ctx), "csvExport")} canManageBilling={hasPermission(ctx, "billing.manage")} />
        </div>
      )}

      <form className="mb-4 flex flex-wrap items-end gap-3" action={base}>
        <input type="hidden" name="tab" value={tab} />
        <div className="grid gap-1.5">
          <Label htmlFor="report-from">From</Label>
          <Input id="report-from" name="from" type="date" defaultValue={range.from} max={range.to} className="w-40" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="report-to">To</Label>
          <Input id="report-to" name="to" type="date" defaultValue={range.to} max={todayFor(ctx)} className="w-40" />
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        <nav aria-label="Quick ranges" className="flex flex-wrap gap-1">
          {rangePresets(ctx).map((p) => {
            const active = p.from === range.from && p.to === range.to;
            return (
              <Button key={p.label} asChild size="sm" variant={active ? "default" : "ghost"}>
                <Link href={qs(tab, p)} aria-current={active ? "true" : undefined}>
                  {p.label}
                </Link>
              </Button>
            );
          })}
        </nav>
      </form>

      <LinkTabs label="Reports" active={tab} tabs={REPORT_KINDS.map((k) => ({ key: k, label: REPORT_LABELS[k], href: qs(k) }))} />
      <div className="mt-4">
        {tab === "revenue" && <Revenue ctx={ctx} range={range} />}
        {tab === "attendance" && <Attendance ctx={ctx} range={range} />}
        {tab === "retention" && <Retention ctx={ctx} range={range} />}
        {tab === "classes" && <Classes ctx={ctx} range={range} />}
      </div>
    </>
  );
}

async function Revenue({ ctx, range }: { ctx: TenantContext; range: DateRange }) {
  const r = await revenueReport(ctx, range);
  const money = (v: number) => formatMoney(v, ctx.gym.currency);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Net revenue" value={money(r.totals.netMinor)} hint="Received minus refunds" />
        <StatTile label="Received" value={money(r.totals.receivedMinor)} hint={`${r.totals.payments.toLocaleString("en-IN")} payments`} />
        <StatTile label="Refunded" value={money(r.totals.refundsMinor)} />
        <StatTile label="Average payment" value={money(r.totals.averageMinor)} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Net revenue by {r.grain}</CardTitle>
          <CardDescription>Money received minus refunds given, by the date it happened.</CardDescription>
        </CardHeader>
        <CardContent>
          <BarChart data={r.series.map((s) => ({ label: s.label, value: s.netMinor }))} valueLabel="net revenue" format={{ kind: "currency", currency: ctx.gym.currency }} height={260} />
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-4">
            <CardTitle>By payment method</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Refunded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.byMethod.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No payments in this period.
                  </TableCell>
                </TableRow>
              )}
              {r.byMethod.map((m) => (
                <TableRow key={m.method}>
                  <TableCell>{PAYMENT_METHOD_LABELS[m.method]}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.payments.toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(m.receivedMinor)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(m.refundsMinor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-4">
            <CardTitle>By membership plan</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.byPlan.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No payments in this period.
                  </TableCell>
                </TableRow>
              )}
              {r.byPlan.map((p) => (
                <TableRow key={p.plan}>
                  <TableCell>{p.plan}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.payments.toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.receivedMinor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

async function Attendance({ ctx, range }: { ctx: TenantContext; range: DateRange }) {
  const r = await attendanceReport(ctx, range);
  const busiest = busiestSlot(r.grid);
  const span = activeHourSpan(r.grid);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Check-ins" value={r.totals.allowed.toLocaleString("en-IN")} hint={`${r.totals.perDay} per day on average`} />
        <StatTile label="Members who visited" value={r.totals.members.toLocaleString("en-IN")} />
        <StatTile label="Busiest time" value={busiest ? `${busiest.day} ${hourLabel(busiest.hour)}` : "—"} hint={busiest ? `${busiest.n} check-ins in that hour` : undefined} />
        <StatTile label="Denied at the door" value={r.totals.denied.toLocaleString("en-IN")} hint="Expired, frozen or no membership" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Check-ins by day and hour</CardTitle>
          <CardDescription>Darker cells are busier. Use it to plan staffing and class times.</CardDescription>
        </CardHeader>
        <CardContent>{r.totals.allowed === 0 ? <EmptyState title="No check-ins in this period" /> : <Heatmap grid={r.grid} firstHour={span.first} lastHour={span.last} />}</CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Average check-ins per weekday</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={r.byWeekday.map((d) => ({ label: d.label, value: d.average }))} valueLabel="check-ins on average" height={220} />
          </CardContent>
        </Card>
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-4">
            <CardTitle>By location</CardTitle>
          </CardHeader>
          <Table>
            <TableBody>
              {r.byLocation.map((l) => (
                <TableRow key={l.name}>
                  <TableCell>{l.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.n.toLocaleString("en-IN")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

async function Retention({ ctx, range }: { ctx: TenantContext; range: DateRange }) {
  const r = await retentionReport(ctx, range);
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Average monthly retention" value={pct(r.averageRetention)} hint="Members active at the start of a month who were still active at its end" />
        <StatTile label="Average monthly churn" value={pct(r.averageChurn)} hint="Members who lapsed during the month" />
        <StatTile label="Active members now" value={(r.series.at(-1)?.activeAtEnd ?? 0).toLocaleString("en-IN")} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Monthly retention rate</CardTitle>
          <CardDescription>{r.currentMonthPartial ? "Completed months only. The current month is in the table, to date." : "Months in the selected range."}</CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const complete = r.series.filter((m) => !m.partial && m.retentionRate !== null);
            return complete.length === 0 ? (
              <EmptyState title="No completed months in this range" description="Pick a longer range to see the trend." />
            ) : (
              <LineChart data={complete.map((m) => ({ label: m.label, value: m.retentionRate! }))} valueLabel="% retained" />
            );
          })()}
        </CardContent>
      </Card>
      <Card className="gap-0 pb-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Active at start</TableHead>
              <TableHead className="text-right">Retained</TableHead>
              <TableHead className="text-right">Churned</TableHead>
              <TableHead className="text-right">New or returning</TableHead>
              <TableHead className="text-right">Active at end</TableHead>
              <TableHead className="text-right">Retention</TableHead>
              <TableHead className="text-right">Churn</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.series.map((m) => (
              <TableRow key={m.month}>
                <TableCell>{m.label}</TableCell>
                <TableCell className="text-right tabular-nums">{m.activeAtStart}</TableCell>
                <TableCell className="text-right tabular-nums">{m.retained}</TableCell>
                <TableCell className="text-right tabular-nums">{m.churned}</TableCell>
                <TableCell className="text-right tabular-nums">{m.gained}</TableCell>
                <TableCell className="text-right tabular-nums">{m.activeAtEnd}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(m.retentionRate)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(m.churnRate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

async function Classes({ ctx, range }: { ctx: TenantContext; range: DateRange }) {
  const rows = await classReport(ctx, range);
  if (rows.length === 0) return <EmptyState title="No classes in this period" description="Schedule classes to see how popular each one is." />;
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Bookings by class</CardTitle>
          <CardDescription>Confirmed spots (booked, attended or no-show) in classes that went ahead.</CardDescription>
        </CardHeader>
        <CardContent>
          <BarChart data={rows.map((c) => ({ label: c.name, value: c.booked }))} valueLabel="bookings" layout="vertical" height={Math.max(160, rows.length * 40)} />
        </CardContent>
      </Card>
      <Card className="gap-0 pb-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Class</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="w-48">Fill rate</TableHead>
              <TableHead className="text-right">Full</TableHead>
              <TableHead className="text-right">Waitlisted</TableHead>
              <TableHead className="text-right">Attendance</TableHead>
              <TableHead className="text-right">Cancelled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
                    {c.name}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.sessions}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className={cn("block h-full rounded-full bg-[var(--chart-1)]")} style={{ width: `${Math.min(100, c.fillRate ?? 0)}%` }} />
                    </span>
                    <span className="w-12 text-right tabular-nums">{pct(c.fillRate)}</span>
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.fullSessions}</TableCell>
                <TableCell className="text-right tabular-nums">{c.waitlisted}</TableCell>
                <TableCell className="text-right tabular-nums" title="Of bookings whose attendance was marked">
                  {pct(c.attendanceRate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.cancelled}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
