import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ImageIcon, Lock, Target } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { MemberStatusBadge } from "@/components/members/member-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime, localTime } from "@/domain/dates";
import { MEASUREMENTS } from "@/domain/progress";
import { NotFoundError } from "@/server/errors";
import { todayFor } from "@/server/services/members/shared";
import { listTrainers, ptClient } from "@/server/services/pt/clients";
import { listPackages } from "@/server/services/pt/packages";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { AssignTrainerDialog, BookSessionDialog, EditGoalDialog, EndAssignmentButton, ProgressChart, PtNoteForm, SessionActions } from "../../pt-forms";
import { SellPackageDialog } from "../../package-forms";
import { GoalBadge, MemberPackagesList, SessionStatusBadge } from "../../pt-shared";

export const metadata: Metadata = { title: "PT client" };

const signed = (n: number | null, unit: string) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n} ${unit}`);

export default async function PtClientPage({ params }: { params: Promise<{ gymSlug: string; memberId: string }> }) {
  const { gymSlug, memberId } = await params;
  const ctx = await requireGymAccess(gymSlug);
  if (!hasPermission(ctx, "workouts.manage") || !ctx.staffId) return <AccessDenied what="personal training" />;
  const isManager = hasPermission(ctx, "pt.manage");
  const canSell = hasPermission(ctx, "payments.record");
  const [d, allTrainers, catalog] = await Promise.all([
    ptClient(ctx, memberId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    isManager || canSell ? listTrainers(ctx) : Promise.resolve([]),
    canSell ? listPackages(ctx, { activeOnly: true }) : Promise.resolve([]),
  ]);
  const tz = ctx.gym.timezone;
  const canWrite = ctx.access.writable && !ctx.supportSessionId;
  const myAssignment = d.assignments.find((a) => a.mine);
  // Managers book with one of this client's trainers; a trainer books for themselves.
  const bookTrainers = isManager ? d.assignments.map((a) => ({ id: a.trainerId, name: a.trainerName })) : [];
  const canBook = canWrite && (isManager ? bookTrainers.length > 0 : !!myAssignment);
  const unassigned = allTrainers.filter((t) => !d.assignments.some((a) => a.trainerId === t.id));
  const now = new Date().getTime();
  const sessionLabel = (s: { startsAt: Date; trainer: { user: { name: string } } }) => `PT session on ${formatDateTime(s.startsAt, tz)} with ${s.trainer.user.name}`;

  return (
    <>
      <Link href={`/g/${gymSlug}/pt/clients`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> PT clients
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{d.member.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{d.member.memberNumber}</span>
            <MemberStatusBadge status={d.member.status} />
            {d.member.membership && <span>{d.member.membership}</span>}
            {hasPermission(ctx, "members.viewAll") && (
              <Link href={`/g/${gymSlug}/members/${d.member.id}`} className="text-primary underline-offset-4 hover:underline">
                Member profile
              </Link>
            )}
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {isManager && unassigned.length > 0 && <AssignTrainerDialog gymSlug={gymSlug} trainers={unassigned} member={{ id: d.member.id, name: d.member.name }} />}
            {canSell && (
              <SellPackageDialog
                gymSlug={gymSlug}
                today={todayFor(ctx)}
                currency={ctx.gym.currency}
                taxRateBps={ctx.gym.taxRateBps}
                packages={catalog}
                trainers={allTrainers}
                member={{ id: d.member.id, name: d.member.name }}
                defaultTrainerId={d.assignments.length === 1 ? d.assignments[0].trainerId : undefined}
              />
            )}
            {canBook && <BookSessionDialog gymSlug={gymSlug} today={todayFor(ctx)} trainers={bookTrainers} member={{ id: d.member.id, name: d.member.name }} canComplimentary={isManager} creditsLeft={d.creditsLeft} />}
          </div>
        )}
      </div>

      {/* Trainers and goals */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Personal training</CardTitle>
          <CardDescription>{d.assignments.length === 0 ? "No trainer at the moment." : "Progress toward each target comes from the member's own measurements."}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {d.assignments.map((a) => (
            <div key={a.id} className="grid gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <p className="font-medium">
                    {a.trainerName}
                    {a.mine && <span className="text-muted-foreground"> (you)</span>}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <GoalBadge goal={a.goal} />
                    Since {formatDate(a.startedOn)}
                    {a.assignedBy && ` · assigned by ${a.assignedBy}`}
                    {a.targets?.targetDate && ` · target date ${formatDate(a.targets.targetDate)}`}
                  </p>
                </div>
                {canWrite && isManager && (
                  <div className="flex gap-2">
                    <EditGoalDialog gymSlug={gymSlug} assignmentId={a.id} trainerName={a.trainerName} goal={a.goal} targets={a.targets} />
                    <EndAssignmentButton gymSlug={gymSlug} assignmentId={a.id} memberName={d.member.name} trainerName={a.trainerName} />
                  </div>
                )}
              </div>
              {a.targets?.note && <p className="text-sm whitespace-pre-wrap">{a.targets.note}</p>}
              {a.progress.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {a.progress.map((p) => (
                    <div key={p.metric} className="grid gap-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <Target className="size-4 text-muted-foreground" aria-hidden /> {p.label}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {p.start} → {p.current} / {p.target} {p.unit}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.label} target progress`}>
                        <div className="h-full rounded-full bg-primary" style={{ width: `${p.percent}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground">{p.reached ? "Target reached" : `${p.percent}% of the way · ${p.remaining} ${p.unit} to go`}</p>
                    </div>
                  ))}
                </div>
              ) : (
                (a.targets?.targetWeightKg !== undefined || a.targets?.targetBodyFatPct !== undefined) && (
                  <p className="text-sm text-muted-foreground">Targets are set; progress shows once the member logs a measurement.</p>
                )
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {/* Progress */}
        <Card>
          <CardHeader>
            <CardTitle>Measurements</CardTitle>
            <CardDescription>Logged by the member in the app.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ProgressChart entries={d.progress.entries} />
            {d.progress.summary.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 font-medium">Measure</th>
                      <th className="py-1 text-right font-medium">Latest</th>
                      <th className="py-1 text-right font-medium">Change</th>
                      <th className="py-1 text-right font-medium">Since</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {d.progress.summary.map((s) => (
                      <tr key={s.key}>
                        <td className="py-1.5">{s.label}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {s.latest} {s.unit}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{signed(s.change, s.unit)}</td>
                        <td className="py-1.5 text-right text-muted-foreground">{formatDate(s.since)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {d.progress.entries.length} entr{d.progress.entries.length === 1 ? "y" : "ies"} · tracks {MEASUREMENTS.map((m) => m.label.toLowerCase()).join(", ")}
            </p>
          </CardContent>
        </Card>

        {/* Workouts */}
        <Card>
          <CardHeader>
            <CardTitle>Workouts</CardTitle>
            <CardDescription>
              {d.workouts.completionRate === null
                ? `${d.workouts.last28Days} workout${d.workouts.last28Days === 1 ? "" : "s"} done in the last 4 weeks.`
                : `${d.workouts.last28Days} of about ${d.workouts.plannedLast28Days} planned workouts done in the last 4 weeks (${d.workouts.completionRate}%).`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {d.workouts.plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workout plan yet.{" "}
                <Link href={`/g/${gymSlug}/workouts`} className="text-primary underline-offset-4 hover:underline">
                  Workout plans
                </Link>
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {d.workouts.plans.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/g/${gymSlug}/workouts/${p.id}`} className="text-primary underline-offset-4 hover:underline">
                      {p.title}
                    </Link>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {p.dayCount} day{p.dayCount === 1 ? "" : "s"}
                      <Badge variant={p.status === "ACTIVE" ? "success" : "secondary"}>{p.status === "ACTIVE" ? "Active" : p.status === "DRAFT" ? "Draft" : "Archived"}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {d.workouts.recent.length > 0 && (
              <div className="grid gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">Recently done</p>
                <ul className="grid gap-1 text-sm">
                  {d.workouts.recent.map((w) => (
                    <li key={w.id}>
                      <span className="text-muted-foreground tabular-nums">{formatDateTime(w.completedAt, tz)}</span> · {w.plan}: {w.day}
                      {w.note && <span className="block pl-4 text-xs text-muted-foreground">“{w.note}”</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sessions */}
        <Card>
          <CardHeader>
            <CardTitle>PT sessions</CardTitle>
            <CardDescription>
              {d.sessions.counts.completed} done · {d.sessions.counts.noShow} no-show{d.sessions.counts.noShow === 1 ? "" : "s"} · {d.sessions.counts.cancelled} cancelled
              {d.sessions.noShowRate !== null && ` · ${d.sessions.noShowRate}% no-show rate`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Upcoming</p>
              {d.sessions.upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing booked.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {d.sessions.upcoming.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span>
                        <span className="tabular-nums">
                          {formatDate(s.startsAt, tz)} {localTime(s.startsAt, tz)}–{localTime(s.endsAt, tz)}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {s.trainer.user.name}
                          {s.focus && ` · ${s.focus}`}
                        </span>
                        <span className={s.purchase || s.complimentary ? "block text-xs text-muted-foreground" : "block text-xs text-amber-700 dark:text-amber-400"}>
                          {s.purchase ? `Uses ${s.purchase.name}` : s.complimentary ? "Complimentary" : "Not covered by a package"}
                        </span>
                      </span>
                      {canWrite && (isManager || s.trainerId === d.viewer.staffId) && <SessionActions gymSlug={gymSlug} sessionId={s.id} started={false} label={sessionLabel(s)} />}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Recent</p>
              {d.sessions.past.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions in the last 4 months.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {d.sessions.past.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span>
                        <span className="tabular-nums">{formatDate(s.startsAt, tz)}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {s.trainer.user.name}
                          {s.focus && ` · ${s.focus}`}
                        </span>
                      </span>
                      {s.status === "SCHEDULED" && s.startsAt.getTime() < now && canWrite && (isManager || s.trainerId === d.viewer.staffId) ? (
                        <SessionActions gymSlug={gymSlug} sessionId={s.id} started label={sessionLabel(s)} />
                      ) : (
                        <SessionStatusBadge status={s.status} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Packages, notes and photos */}
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>PT packages</CardTitle>
              <CardDescription>
                {d.creditsLeft === 0 ? "No sessions left to book." : `${d.creditsLeft} session${d.creditsLeft === 1 ? "" : "s"} left to book.`} Cancelled sessions give their credit back.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MemberPackagesList packages={d.packages} slug={gymSlug} showInvoices={hasPermission(ctx, "payments.view")} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Trainer notes</CardTitle>
              <CardDescription>Private: the author and the gym&apos;s managers.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {d.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                <ul className="grid gap-3 text-sm">
                  {d.notes.map((n) => (
                    <li key={n.id} className="grid gap-0.5">
                      <p className="whitespace-pre-wrap">{n.body}</p>
                      <p className="text-xs text-muted-foreground">
                        {n.mine ? "You" : n.author} · {formatDateTime(n.createdAt, tz)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {canWrite && (isManager || d.viewer.isTrainer) && <PtNoteForm gymSlug={gymSlug} memberId={d.member.id} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="size-4" aria-hidden /> Progress photos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d.photoCount === null ? (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Lock className="mt-0.5 size-4 shrink-0" aria-hidden /> Private to the member and their assigned trainers. Not shown to managers or owners.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {d.photoCount} photo{d.photoCount === 1 ? "" : "s"}. Open this client in the trainer app to view them (every view is recorded in the audit log).
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {d.history.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Earlier trainers</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {d.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{h.trainerName}</span>
                    <GoalBadge goal={h.goal} />
                  </span>
                  <span className="text-muted-foreground">
                    {formatDate(h.startedOn)} – {formatDate(h.endedAt, tz)}
                    {h.endReason && ` · ${h.endReason}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
