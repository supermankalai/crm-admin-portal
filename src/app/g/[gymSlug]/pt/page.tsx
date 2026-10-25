import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, CalendarCheck, Dumbbell, UserCheck, Users } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatTile } from "@/components/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, localTime } from "@/domain/dates";
import { PT_GOAL_LABELS } from "@/domain/pt";
import { listTrainers } from "@/server/services/pt/clients";
import { ptOverview } from "@/server/services/pt/overview";
import { liveSessionsAvailable } from "@/server/services/live/join";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { todayFor } from "@/server/services/members/shared";
import { AssignTrainerDialog, BookSessionDialog } from "./pt-forms";
import { GoalBadge, PtTabs } from "./pt-shared";

export const metadata: Metadata = { title: "Personal training" };

export default async function PtOverviewPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "workouts.manage") || !ctx.staffId) return <AccessDenied what="personal training" />;
  const isManager = hasPermission(ctx, "pt.manage");
  const [o, trainers] = await Promise.all([ptOverview(ctx), isManager ? listTrainers(ctx) : Promise.resolve([])]);
  const slug = ctx.gym.slug;
  const tz = ctx.gym.timezone;
  const canWrite = ctx.access.writable && !ctx.supportSessionId;
  const client = (id: string) => `/g/${slug}/pt/clients/${id}`;
  const w = o.totals.week;

  return (
    <>
      <PageHeader
        title="Personal training"
        description={isManager ? "Who trains whom, their goals, sessions and results." : "Your PT clients, their goals, sessions and results."}
        actions={
          canWrite && (
            <div className="flex flex-wrap gap-2">
              {isManager && <AssignTrainerDialog gymSlug={slug} trainers={trainers} />}
              <BookSessionDialog canBookOnline={liveSessionsAvailable(ctx)} gymSlug={slug} today={todayFor(ctx)} trainers={isManager ? trainers : []} canComplimentary={isManager} />
            </div>
          )
        }
      />
      <PtTabs slug={slug} active="overview" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={isManager ? "PT clients" : "My clients"} value={o.totals.clients} hint={`${o.totals.newThisMonth} new this month`} icon={<Users />} />
        {isManager ? (
          <StatTile label="Trainers coaching" value={`${o.totals.trainersWithClients} of ${o.totals.trainers}`} hint="Active trainers with at least one client" icon={<UserCheck />} />
        ) : (
          <StatTile label="Booked this week" value={w.scheduled} hint="Sessions still to come or to close" icon={<CalendarCheck />} />
        )}
        <StatTile label="Sessions done this week" value={w.completed} hint={`${w.noShow} no-show${w.noShow === 1 ? "" : "s"} · ${w.cancelled} cancelled`} icon={<Dumbbell />} />
        <StatTile label="Need attention" value={o.needsAttention.length} hint="No session in 3 weeks and nothing booked" icon={<AlertCircle />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Next 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            {o.upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No PT sessions booked in the next 7 days.</p>
            ) : (
              <ul className="divide-y text-sm">
                {o.upcoming.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                    <span className="w-36 shrink-0 tabular-nums text-muted-foreground">
                      {formatDate(s.startsAt, tz)} {localTime(s.startsAt, tz)}
                    </span>
                    <Link href={client(s.member.id)} className="font-medium text-primary underline-offset-4 hover:underline">
                      {s.member.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {isManager ? `with ${s.trainer}` : ""}
                      {s.focus ? `${isManager ? " · " : ""}${s.focus}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Need attention</CardTitle>
          </CardHeader>
          <CardContent>
            {o.needsAttention.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every client has had a session in the last 3 weeks or has one booked.</p>
            ) : (
              <ul className="divide-y text-sm">
                {o.needsAttention.map((a) => (
                  <li key={a.memberId} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                    <Link href={client(a.memberId)} className="font-medium text-primary underline-offset-4 hover:underline">
                      {a.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {isManager ? `${a.trainer} · ` : ""}
                      {a.lastSession ? `last session ${formatDate(a.lastSession, tz)}` : "no sessions yet"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {isManager && (
        <Card className="mt-4 gap-0 pb-0">
          <CardHeader className="pb-4">
            <CardTitle>Trainers this month</CardTitle>
          </CardHeader>
          {o.trainers.length === 0 ? (
            <EmptyState icon={<UserCheck />} title="No trainers yet" description="Invite staff with the Trainer role under Staff, then assign them clients here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Trainer</TableHead>
                  <TableHead className="text-right">Clients</TableHead>
                  <TableHead className="text-right">Sessions done</TableHead>
                  <TableHead className="text-right">No-shows</TableHead>
                  <TableHead className="text-right">No-show rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.trainers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link href={`/g/${slug}/pt/clients?trainer=${t.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.clients}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.completedThisMonth}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.noShowsThisMonth}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.noShowRate === null ? "—" : `${t.noShowRate}%`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Goals</CardTitle>
          </CardHeader>
          <CardContent>
            {o.goals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No clients yet.</p>
            ) : (
              <ul className="grid gap-1.5 text-sm">
                {o.goals.map((g) => (
                  <li key={g.goal} className="flex justify-between gap-3">
                    <span>{g.goal === "NONE" ? "No goal set" : PT_GOAL_LABELS[g.goal]}</span>
                    <span className="tabular-nums text-muted-foreground">{g.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recently assigned</CardTitle>
          </CardHeader>
          <CardContent>
            {o.recentAssignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {o.recentAssignments.map((a) => (
                  <li key={a.id} className="grid gap-0.5">
                    <span>
                      <Link href={client(a.memberId)} className="font-medium text-primary underline-offset-4 hover:underline">
                        {a.name}
                      </Link>
                      {isManager && <span className="text-muted-foreground"> → {a.trainer}</span>}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <GoalBadge goal={a.goal} /> {formatDateTime(a.at, tz)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ended in the last 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            {o.recentEnded.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {o.recentEnded.map((h) => (
                  <li key={h.id} className="grid gap-0.5">
                    <span>
                      {h.name}
                      {isManager && <span className="text-muted-foreground"> · {h.trainer}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(h.at, tz)}
                      {h.reason ? ` · ${h.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
