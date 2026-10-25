import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMemberNumber } from "@/domain/member-search";
import { listCheckInLocations, todaysCheckIns } from "@/server/services/checkin";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { CheckInConsole } from "./check-in-console";

export const metadata: Metadata = { title: "Check-in" };

const RESULT: Record<string, { label: string; variant: "success" | "warning" | "info" }> = {
  ALLOWED: { label: "In", variant: "success" },
  DENIED_EXPIRED: { label: "Expired", variant: "warning" },
  DENIED_FROZEN: { label: "Frozen", variant: "info" },
  DENIED_NO_MEMBERSHIP: { label: "No membership", variant: "warning" },
};
const METHOD: Record<string, string> = { QR: "QR", MEMBER_ID: "ID", NAME_SEARCH: "Name" };

export default async function CheckInPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "checkin.perform")) return <AccessDenied what="check-in" />;
  const locations = await listCheckInLocations(ctx);
  const today = await todaysCheckIns(ctx);
  const writable = ctx.access.writable && !ctx.supportSessionId;
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: ctx.gym.timezone });

  return (
    <>
      <PageHeader title="Check-in" description="Scan a member's QR code, or search by name or member ID. Every attempt is recorded." />
      <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardContent>
            {writable ? (
              <CheckInConsole gymSlug={ctx.gym.slug} locations={locations} canSell={hasPermission(ctx, "payments.record")} writable={writable} />
            ) : (
              <p className="text-sm text-muted-foreground">Check-in is unavailable while the gym is read-only.</p>
            )}
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <div className="grid grid-cols-2 gap-4">
            <StatTile label="Checked in today" value={today.allowed} />
            <StatTile label="Denied today" value={today.denied} />
          </div>
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Today</CardTitle>
            </CardHeader>
            <CardContent>
              {today.recent.length === 0 ? (
                <EmptyState title="No check-ins yet today" />
              ) : (
                <ul className="grid gap-1.5 text-sm" aria-label="Today's check-ins">
                  {today.recent.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">{time.format(c.checkedInAt)}</span>
                      <Link href={`/g/${ctx.gym.slug}/members/${c.member.id}`} className="min-w-0 flex-1 truncate hover:underline">
                        {c.member.firstName} {c.member.lastName} <span className="font-mono text-xs text-muted-foreground">{formatMemberNumber(c.member.memberNumber)}</span>
                      </Link>
                      <span className="text-xs text-muted-foreground">{METHOD[c.method]}</span>
                      <Badge variant={RESULT[c.result].variant}>{RESULT[c.result].label}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
