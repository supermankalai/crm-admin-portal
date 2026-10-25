import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, Users } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { MemberStatusBadge } from "@/components/members/member-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/domain/dates";
import { PT_GOAL_LABELS, PT_GOALS, type PtGoal } from "@/domain/pt";
import { listPtClients, listTrainers } from "@/server/services/pt/clients";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { AssignTrainerDialog } from "../pt-forms";
import { GoalBadge, PtTabs } from "../pt-shared";

export const metadata: Metadata = { title: "PT clients" };

export default async function PtClientsPage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<{ trainer?: string; goal?: string; q?: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "workouts.manage") || !ctx.staffId) return <AccessDenied what="personal training" />;
  const sp = await searchParams;
  const isManager = hasPermission(ctx, "pt.manage");
  const goal = (PT_GOALS as readonly string[]).includes(sp.goal ?? "") ? (sp.goal as PtGoal) : undefined;
  const [{ clients }, trainers] = await Promise.all([listPtClients(ctx, { trainerId: sp.trainer, goal, q: sp.q }), isManager ? listTrainers(ctx) : Promise.resolve([])]);
  const slug = ctx.gym.slug;
  const tz = ctx.gym.timezone;
  const canWrite = ctx.access.writable && !ctx.supportSessionId;
  const filtered = !!(sp.trainer || goal || sp.q);

  return (
    <>
      <PageHeader
        title="PT clients"
        description={isManager ? "Every member with a personal trainer. Open one to see their goal and results." : "Your personal training clients. Open one to see their goal and results."}
        actions={canWrite && isManager && <AssignTrainerDialog gymSlug={slug} trainers={trainers} />}
      />
      <PtTabs slug={slug} active="clients" />

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Name or M-number" aria-label="Search clients" className="w-56" />
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
        <NativeSelect name="goal" defaultValue={goal ?? ""} aria-label="Filter by goal" className="w-44">
          <option value="">All goals</option>
          {PT_GOALS.map((g) => (
            <option key={g} value={g}>
              {PT_GOAL_LABELS[g]}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {filtered && (
          <Button asChild variant="ghost">
            <Link href={`/g/${slug}/pt/clients`}>Clear</Link>
          </Button>
        )}
      </form>

      <Card className="gap-0 py-0">
        {clients.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={filtered ? "No clients match" : "No PT clients yet"}
            description={isManager ? "Use Assign trainer to give a member a personal trainer." : "Your manager assigns clients to you. You'll get a notification when they do."}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Client</TableHead>
                  <TableHead>{isManager ? "Trainer and goal" : "Goal"}</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead className="text-right">Sessions (30 days)</TableHead>
                  <TableHead>Last session</TableHead>
                  <TableHead>Next session</TableHead>
                  <TableHead>Last measured</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.memberId}>
                    <TableCell>
                      <Link href={`/g/${slug}/pt/clients/${c.memberId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        {c.name}
                      </Link>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{c.memberNumber}</span>
                        <MemberStatusBadge status={c.status} />
                        {c.needsAttention && (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                            <AlertCircle className="size-3" aria-hidden /> Needs attention
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ul className="grid gap-1">
                        {c.trainers.map((t) => (
                          <li key={t.assignmentId} className="flex flex-wrap items-center gap-2 text-sm">
                            {isManager && <span>{t.name}</span>}
                            <GoalBadge goal={t.goal} />
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{formatDate(c.since)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.sessions30d}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{c.lastSession ? formatDate(c.lastSession, tz) : "—"}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{c.nextSession ? formatDate(c.nextSession, tz) : "—"}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{c.lastMeasuredOn ? formatDate(c.lastMeasuredOn) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
