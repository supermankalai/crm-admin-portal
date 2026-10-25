import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { GymStatusBadge, SubscriptionStatusBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/domain/money";
import { NotFoundError } from "@/server/errors";
import { requirePlatformAdmin } from "@/server/platform/guard";
import { getGymDetail } from "@/server/platform/services";
import { SubscriptionActions } from "./subscription-actions";
import { SupportAccessForm } from "./support-access-form";

export const metadata: Metadata = { title: "Gym" };

const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export default async function AdminGymPage({ params }: { params: Promise<{ gymId: string }> }) {
  const admin = await requirePlatformAdmin();
  const { gymId } = await params;
  const detail = await getGymDetail(admin.id, gymId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { gym, usage, plans, audit } = detail;
  const sub = gym.subscription;
  const planName = new Map(plans.map((p) => [p.id, p.name]));

  return (
    <>
      <Link href="/admin/gyms" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All gyms
      </Link>
      <PageHeader title={gym.name} description={`/g/${gym.slug} · created ${date.format(gym.createdAt)} · ${gym.timezone} · ${gym.currency}`} actions={<GymStatusBadge status={gym.status} />} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Manual billing: changes take effect immediately and are recorded in the history below.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {sub ? (
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-x-8">
                <Row label="Plan">{sub.plan.name}</Row>
                <Row label="Price">{formatMoney(sub.plan.priceMonthlyMinor, sub.plan.currency)} / month</Row>
                <Row label="Status">
                  <SubscriptionStatusBadge status={sub.status} />
                </Row>
                <Row label="Provider">{sub.provider === "MANUAL" ? "Manual" : sub.provider}</Row>
                <Row label="Period">
                  {date.format(sub.currentPeriodStart)} – {date.format(sub.currentPeriodEnd)}
                </Row>
                {sub.status === "TRIALING" && sub.trialEndsAt && <Row label="Trial ends">{date.format(sub.trialEndsAt)}</Row>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No subscription.</p>
            )}
            <SubscriptionActions gymId={gym.id} gymStatus={gym.status} currentPlanCode={sub?.plan.code ?? null} plans={plans} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Counts only — no member data</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Row label="Members">
              {usage.members.toLocaleString("en-IN")}
              {sub && <span className="text-muted-foreground"> / {sub.plan.maxMembers.toLocaleString("en-IN")}</span>}
            </Row>
            <Row label="Active staff">
              {usage.staff}
              {sub && <span className="text-muted-foreground"> / {sub.plan.maxStaff}</span>}
            </Row>
            <Row label="Locations">
              {usage.locations}
              {sub && <span className="text-muted-foreground"> / {sub.plan.maxLocations}</span>}
            </Row>
            <Row label="Check-ins, last 30 days">{usage.checkIns30d.toLocaleString("en-IN")}</Row>
            <Row label="Contact">{gym.email ?? "—"}</Row>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Support access</CardTitle>
          <CardDescription>Super admins cannot browse gym data without an explicit, time-limited support session.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <SupportAccessForm gymId={gym.id} gymName={gym.name} />
          <div>
            <h3 className="mb-2 text-sm font-medium">Recent sessions</h3>
            {gym.supportSessions.length ? (
              <ul className="grid gap-2 text-sm">
                {gym.supportSessions.map((s) => (
                  <li key={s.id} className="rounded-md border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{s.superAdmin.name}</span>
                      <span className="text-xs text-muted-foreground">{dateTime.format(s.startedAt)}</span>
                    </div>
                    <p className="text-muted-foreground">{s.reason}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No support sessions yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card className="gap-0 py-0">
          <CardHeader className="py-5">
            <CardTitle>Subscription history</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Period end</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gym.subscriptionHistory.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="text-xs">{dateTime.format(h.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{h.action.replace("_", " ").toLowerCase()}</Badge>
                    {h.note && <div className="mt-1 max-w-56 truncate text-xs whitespace-normal text-muted-foreground">{h.note}</div>}
                  </TableCell>
                  <TableCell className="text-xs">{h.toPlanId ? planName.get(h.toPlanId) : "—"}</TableCell>
                  <TableCell className="text-xs">{h.newPeriodEnd ? date.format(h.newPeriodEnd) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card className="gap-0 py-0">
          <CardHeader className="py-5">
            <CardTitle>Platform audit for this gym</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs">{dateTime.format(a.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs">{a.action}</TableCell>
                  <TableCell className="font-mono text-xs">{a.ip ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
