import { Activity, Building2, Clock, IndianRupee, Users } from "lucide-react";
import { BarChart } from "@/components/charts/bar-chart";
import { PageHeader } from "@/components/layout/page-header";
import { StatTile } from "@/components/stat-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/domain/money";
import { requirePlatformAdmin } from "@/server/platform/guard";
import { getPlatformStats } from "@/server/platform/services";
import { RunExpiryButton } from "./run-expiry-button";

const MONTH = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });

export default async function AdminOverviewPage() {
  const admin = await requirePlatformAdmin();
  const stats = await getPlatformStats(admin.id);
  const byStatus = stats.gymsByStatus;
  const totalGyms = Object.values(byStatus).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Aggregated across all gyms. Individual gym data requires an explicit support session."
        actions={<RunExpiryButton />}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Gyms" value={totalGyms} icon={<Building2 />} hint={`${byStatus.ACTIVE ?? 0} active · ${byStatus.TRIAL ?? 0} trial · ${byStatus.SUSPENDED ?? 0} suspended · ${byStatus.CANCELLED ?? 0} cancelled`} />
        <StatTile label="Monthly recurring revenue" value={formatMoney(stats.mrrMinor, "INR")} icon={<IndianRupee />} hint="Active, paid-up subscriptions" />
        <StatTile label="Trials ending in 7 days" value={stats.trialsEndingSoon} icon={<Clock />} hint="Follow up to convert" />
        <StatTile label="Members on the platform" value={stats.totalMembers.toLocaleString("en-IN")} icon={<Users />} hint={`${stats.activeMemberships.toLocaleString("en-IN")} active memberships`} />
        <StatTile label="Check-ins, last 30 days" value={stats.checkInsLast30Days.toLocaleString("en-IN")} icon={<Activity />} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Gym sign-ups</CardTitle>
            <CardDescription>New gyms per month, last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart
              valueLabel="sign-ups"
              data={stats.signupsByMonth.map((m) => ({ label: MONTH.format(new Date(`${m.month}-01T00:00:00Z`)), value: m.count }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Gyms by plan</CardTitle>
            <CardDescription>Current subscriptions</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart layout="vertical" valueLabel="gyms" height={200} data={stats.gymsByPlan.map((p) => ({ label: p.name, value: p.count }))} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
