import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { DeliveryBadge, JoinCallButton } from "@/components/live/live-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, formatDate, isDateString, localDate, localTime } from "@/domain/dates";
import { liveAttendance, presenceLabel } from "@/server/services/live/attendance";
import { liveSessionsAvailable } from "@/server/services/live/join";
import { todayFor } from "@/server/services/members/shared";
import { listTrainers } from "@/server/services/pt/clients";
import { listSessions } from "@/server/services/pt/sessions";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { BookSessionDialog, SessionActions } from "../pt-forms";
import { PtTabs, SESSION_STATUS, SessionStatusBadge } from "../pt-shared";

export const metadata: Metadata = { title: "PT sessions" };

const STATUSES = ["SCHEDULED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;
type Status = (typeof STATUSES)[number];

export default async function PtSessionsPage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<{ from?: string; trainer?: string; status?: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "workouts.manage") || !ctx.staffId) return <AccessDenied what="personal training" />;
  const sp = await searchParams;
  const isManager = hasPermission(ctx, "pt.manage");
  const today = todayFor(ctx);
  const from = sp.from && isDateString(sp.from) ? sp.from : today;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as Status) : undefined;
  const [{ sessions, to }, trainers] = await Promise.all([
    listSessions(ctx, { from, to: addDays(from, 6), trainerId: sp.trainer, status }),
    isManager ? listTrainers(ctx) : Promise.resolve([]),
  ]);
  const slug = ctx.gym.slug;
  // Who joined the online sessions (from LiveKit's webhook).
  const presence = await liveAttendance(ctx, "pt", sessions.filter((s) => s.deliveryMode === "ONLINE").map((s) => s.id));
  const tz = ctx.gym.timezone;
  const canWrite = ctx.access.writable && !ctx.supportSessionId;
  const now = new Date().getTime();
  const base = `/g/${slug}/pt/sessions`;
  const qs = (f: string) => `${base}?${new URLSearchParams({ from: f, ...(sp.trainer ? { trainer: sp.trainer } : {}), ...(status ? { status } : {}) })}`;

  // Group by gym-local day.
  const days = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const d = localDate(s.startsAt, tz);
    days.set(d, [...(days.get(d) ?? []), s]);
  }

  return (
    <>
      <PageHeader
        title="PT sessions"
        description={isManager ? "Every personal training session in the gym. Close sessions once they've happened." : "Your personal training sessions. Close them once they've happened."}
        actions={canWrite && <BookSessionDialog gymSlug={slug} today={today} trainers={isManager ? trainers : []} defaultTrainerId={sp.trainer} canComplimentary={isManager} canBookOnline={liveSessionsAvailable(ctx)} />}
      />
      <PtTabs slug={slug} active="sessions" />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label="Previous week">
            <Link href={qs(addDays(from, -7))}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <span className="min-w-44 text-center text-sm font-medium">
            {formatDate(from)} – {formatDate(to)}
          </span>
          <Button asChild variant="outline" size="icon" aria-label="Next week">
            <Link href={qs(addDays(from, 7))}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
          {from !== today && (
            <Button asChild variant="ghost" size="sm">
              <Link href={qs(today)}>Today</Link>
            </Button>
          )}
        </div>
        <form className="flex flex-wrap items-end gap-2" role="search">
          <input type="hidden" name="from" value={from} />
          {isManager && (
            <NativeSelect name="trainer" defaultValue={sp.trainer ?? ""} aria-label="Filter by trainer" className="w-48">
              <option value="">All trainers</option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <NativeSelect name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="w-40">
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {SESSION_STATUS[s].label}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
      </div>

      <Card className="gap-0 py-0">
        {sessions.length === 0 ? (
          <EmptyState icon={<CalendarDays />} title="No PT sessions this week" description="Book one with Book session, or from a client's page." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Time</TableHead>
                  <TableHead>Client</TableHead>
                  {isManager && <TableHead>Trainer</TableHead>}
                  <TableHead>Focus</TableHead>
                  <TableHead>Cover</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...days.entries()].map(([day, list]) => [
                  <TableRow key={day} className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={isManager ? 7 : 6} className="py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {formatDate(day, tz, "long")}
                      {day === today && " · Today"}
                    </TableCell>
                  </TableRow>,
                  ...list.map((s) => {
                    const started = s.startsAt.getTime() <= now;
                    const label = `PT session with ${s.member.name} at ${localTime(s.startsAt, tz)}`;
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="tabular-nums whitespace-nowrap">
                          {localTime(s.startsAt, tz)}–{localTime(s.endsAt, tz)}
                        </TableCell>
                        <TableCell>
                          <Link href={`/g/${slug}/pt/clients/${s.member.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                            {s.member.name}
                          </Link>
                        </TableCell>
                        {isManager && <TableCell className="text-sm">{s.trainer.name}</TableCell>}
                        <TableCell className="text-sm text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {s.focus ?? "—"} <DeliveryBadge mode={s.deliveryMode} />
                          </div>
                          {presence.get(s.id)?.get(s.member.id) && <div className="text-xs text-sky-700 dark:text-sky-400">Client {presenceLabel(presence.get(s.id)!.get(s.member.id)!)}</div>}
                        </TableCell>
                        <TableCell className={s.cover || s.status === "CANCELLED" ? "text-sm text-muted-foreground" : "text-sm text-amber-700 dark:text-amber-400"}>
                          {s.status === "CANCELLED" ? "—" : (s.cover ?? "Not covered")}
                        </TableCell>
                        <TableCell>
                          <SessionStatusBadge status={s.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {s.isMine && s.deliveryMode === "ONLINE" && s.status === "SCHEDULED" && <JoinCallButton gymSlug={slug} kind="pt" sessionId={s.id} startsAt={s.startsAt} endsAt={s.endsAt} timeZone={tz} />}
                            {canWrite && s.canChange && s.status === "SCHEDULED" && <SessionActions gymSlug={slug} sessionId={s.id} started={started} label={label} />}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }),
                ])}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
