import type { Metadata } from "next";
import Link from "next/link";
import { Activity, CalendarClock, IndianRupee, ScanLine, UserPlus, Users } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { diffDays, formatDate } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { ROLE_LABELS } from "@/domain/permissions";
import { getDashboard } from "@/server/services/dashboard";
import { hasPermission, requireGymAccess } from "@/server/tenant";

export const metadata: Metadata = { title: "Dashboard" };

const monthLabel = (firstDay: string) => new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(`${firstDay}T00:00:00Z`));

export default async function DashboardPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "dashboard.view")) return <AccessDenied what="the dashboard" />;
  const d = await getDashboard(ctx);
  const slug = ctx.gym.slug;
  const tz = ctx.gym.timezone;
  const money = (v: number) => formatMoney(v, ctx.gym.currency);
  const time = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });

  return (
    <>
      <PageHeader
        title={`Welcome back, ${ctx.user.name.split(" ")[0]}`}
        description={`${ctx.gym.name} · ${formatDate(d.today, tz, "long")} · ${ctx.supportSessionId ? "support access" : ROLE_LABELS[ctx.role]}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {d.myClients !== null ? (
          <StatTile label="My clients" value={d.myClients} icon={<Users />} hint={<Link href={`/g/${slug}/members`} className="underline-offset-4 hover:underline">View clients</Link>} />
        ) : (
          <StatTile label="Active members" value={d.activeMembers.toLocaleString("en-IN")} icon={<Users />} hint="With a membership covering today" />
        )}
        <StatTile label="New sign-ups this month" value={d.newThisMonth} icon={<UserPlus />} />
        {d.revenue && (
          <>
            <StatTile label="Revenue today" value={money(d.revenue.today)} icon={<IndianRupee />} hint="Payments minus refunds" />
            <StatTile label="Revenue this month" value={money(d.revenue.month)} icon={<IndianRupee />} hint="Payments minus refunds" />
          </>
        )}
        <StatTile label="Check-ins today" value={d.checkInsToday} icon={<ScanLine />} />
        <StatTile label="Expiring in 7 days" value={d.expiring.length} icon={<CalendarClock />} hint="Not yet renewed" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {d.revenue && (
          <Card>
            <CardHeader>
              <CardTitle>Revenue</CardTitle>
              <CardDescription>Net revenue per month, last 6 months</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                valueLabel="net revenue"
                format={{ kind: "currency", currency: ctx.gym.currency }}
                data={d.revenue.trend.map((r) => ({ label: monthLabel(r.month), value: r.netMinor }))}
              />
            </CardContent>
          </Card>
        )}
        <Card className={d.revenue ? "" : "lg:col-span-2"}>
          <CardHeader>
            <CardTitle>Membership growth</CardTitle>
            <CardDescription>Active members at the end of each month (today for this month)</CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart valueLabel="active members" data={d.growth.map((g) => ({ label: monthLabel(g.month), value: g.activeMembers }))} />
            <p className="mt-2 text-xs text-muted-foreground">
              New members: {d.growth.map((g) => `${monthLabel(g.month)} ${g.newMembers}`).join(" · ")}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Memberships expiring soon</CardTitle>
            <CardDescription>Ending in the next 7 days with no renewal yet</CardDescription>
          </CardHeader>
          <CardContent>
            {d.expiring.length === 0 ? (
              <EmptyState icon={<CalendarClock />} title="Nothing expiring this week" />
            ) : (
              <ul className="grid gap-2">
                {d.expiring.slice(0, 8).map((e) => {
                  const days = diffDays(d.today, e.endDate);
                  return (
                    <li key={e.membershipId}>
                      <Link href={`/g/${slug}/members/${e.memberId}`} className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm hover:bg-accent">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{e.name}</span>
                          <span className="block text-xs text-muted-foreground">{e.plan}</span>
                        </span>
                        <Badge variant={days <= 1 ? "danger" : "warning"}>{days === 0 ? "Ends today" : days === 1 ? "Ends tomorrow" : `${days} days`}</Badge>
                      </Link>
                    </li>
                  );
                })}
                {d.expiring.length > 8 && (
                  <li>
                    <Button asChild variant="link" className="px-0">
                      <Link href={`/g/${slug}/members?status=active`}>and {d.expiring.length - 8} more…</Link>
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{d.ownClassesOnly ? "My upcoming classes" : "Upcoming classes"}</CardTitle>
            <CardDescription>Next scheduled sessions</CardDescription>
          </CardHeader>
          <CardContent>
            {d.upcomingClasses.length === 0 ? (
              <EmptyState icon={<Activity />} title="No upcoming classes" />
            ) : (
              <ul className="grid gap-2">
                {d.upcomingClasses.map((c) => {
                  const booked = c._count.bookings;
                  const full = booked >= c.capacity;
                  return (
                    <li key={c.id} className="flex items-center gap-3 rounded-md border p-2.5 text-sm">
                      <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: c.classType.color }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.classType.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {time.format(c.startsAt)} · {c.room.name} · {c.trainer.user.name}
                        </span>
                      </span>
                      <Badge variant={full ? "warning" : "secondary"} className="tabular-nums">
                        {booked}/{c.capacity}
                        {full ? " full" : ""}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
