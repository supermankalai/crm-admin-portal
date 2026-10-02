import type { Metadata } from "next";
import { Building2, CalendarClock, MapPin, ShieldCheck, Users } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS, type GymRole } from "@/domain/permissions";
import { getGymOverview } from "@/server/services/gym-overview";
import { hasPermission, requireGymAccess } from "@/server/tenant";

export const metadata: Metadata = { title: "Dashboard" };

const CAPABILITIES: { permission: Parameters<typeof hasPermission>[1]; label: string }[] = [
  { permission: "members.create", label: "Sign up new members" },
  { permission: "checkin.perform", label: "Check members in" },
  { permission: "payments.record", label: "Record payments" },
  { permission: "payments.refund", label: "Issue refunds" },
  { permission: "plans.manage", label: "Manage membership plans" },
  { permission: "classes.manage", label: "Manage all classes" },
  { permission: "classes.manageOwn", label: "Manage your own classes" },
  { permission: "staff.invite", label: "Invite staff" },
  { permission: "reports.view", label: "View reports" },
  { permission: "settings.manage", label: "Change gym settings and billing" },
  { permission: "audit.view", label: "View the audit log" },
];

function formatDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone }).format(date);
}

export default async function DashboardPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "dashboard.view")) return <AccessDenied what="the dashboard" />;
  const overview = await getGymOverview(ctx);
  const { access, plan } = ctx;

  return (
    <>
      <PageHeader title={`Welcome back, ${ctx.user.name.split(" ")[0]}`} description={`${ctx.gym.name} · you are signed in as ${ROLE_LABELS[ctx.role]}`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Members", value: overview.members, icon: Users },
          { label: "Active staff", value: overview.staff, icon: Building2 },
          { label: "Locations", value: overview.locations, icon: MapPin },
          {
            label: access.isTrial ? "Trial days left" : "Days until renewal",
            value: access.daysRemaining === null ? "—" : Math.max(access.daysRemaining, 0),
            icon: CalendarClock,
          },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="gap-0 py-5">
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                {label}
                <Icon className="size-4" aria-hidden />
              </div>
              <div className="text-2xl font-bold tabular-nums">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Your gym&apos;s FitCRM plan</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Plan</span>
              <span className="font-medium">{plan?.name ?? "None"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              {access.writable ? (
                <Badge variant={access.isTrial ? "info" : "success"}>{access.isTrial ? "Free trial" : "Active"}</Badge>
              ) : (
                <Badge variant="warning">Read-only</Badge>
              )}
            </div>
            {access.endsAt && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{access.isTrial ? "Trial ends" : "Current period ends"}</span>
                <span className="font-medium">{formatDate(access.endsAt, ctx.gym.timezone)}</span>
              </div>
            )}
            {plan && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Limits</span>
                <span className="text-right">
                  {plan.maxMembers.toLocaleString()} members · {plan.maxStaff} staff · {plan.maxLocations} location{plan.maxLocations > 1 ? "s" : ""}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Currency · tax</span>
              <span className="font-medium">
                {ctx.gym.currency} · {(ctx.gym.taxRateBps / 100).toFixed(2)}% tax
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" aria-hidden /> Your access
            </CardTitle>
            <CardDescription>What the {ROLE_LABELS[ctx.role]} role can do in this gym</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {CAPABILITIES.filter((c) => hasPermission(ctx, c.permission)).map((c) => (
                <li key={c.permission} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                  {c.label}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 border-t pt-3 text-xs text-muted-foreground">
              Team:
              {(Object.entries(overview.staffByRole) as [GymRole, number][]).map(([role, count]) => (
                <Badge key={role} variant="outline">
                  {count} {ROLE_LABELS[role]}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
