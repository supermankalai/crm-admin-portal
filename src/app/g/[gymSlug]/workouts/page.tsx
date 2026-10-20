import type { Metadata } from "next";
import Link from "next/link";
import { Dumbbell, Plus } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { LinkTabs } from "@/components/link-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/domain/dates";
import { listGymPlans } from "@/server/services/fitness/workouts";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { PLAN_STATUS } from "./plan-shared";

export const metadata: Metadata = { title: "Workout plans" };

const STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;
type Status = (typeof STATUSES)[number];

/** Trainers' workout plans: managers and owners see the whole gym; trainers their own and their clients'. */
export default async function WorkoutsPage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<{ status?: string; trainer?: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "workouts.manage")) return <AccessDenied what="workout plans" />;
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as Status) : undefined;
  const { plans, trainers } = await listGymPlans(ctx, { status, trainerId: sp.trainer || undefined });
  const base = `/g/${ctx.gym.slug}/workouts`;
  const canWrite = ctx.access.writable && !ctx.supportSessionId;
  const qs = (s?: string) => `${base}?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(sp.trainer ? { trainer: sp.trainer } : {}) })}`;

  return (
    <>
      <PageHeader
        title="Workout plans"
        description="Plans trainers write for clients, and templates to give to anyone. Clients follow active plans in the member app."
        actions={
          canWrite && (
            <Button asChild>
              <Link href={`${base}/new`}>
                <Plus aria-hidden /> New template
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <LinkTabs label="Plan status" active={status ?? "all"} tabs={[{ key: "all", label: "All", href: qs() }, ...STATUSES.map((s) => ({ key: s, label: PLAN_STATUS[s].label, href: qs(s) }))]} />
        {trainers.length > 1 && (
          <form className="flex items-end gap-2" role="search">
            {status && <input type="hidden" name="status" value={status} />}
            <NativeSelect name="trainer" defaultValue={sp.trainer ?? ""} aria-label="Filter by trainer" className="w-48">
              <option value="">All trainers</option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" variant="outline">
              Filter
            </Button>
          </form>
        )}
      </div>
      <Card className="gap-0 py-0">
        {plans.length === 0 ? (
          <EmptyState icon={<Dumbbell />} title="No plans here" description="Trainers can write plans from the mobile app or here." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Plan</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Trainer</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`${base}/${p.id}`} className="font-medium hover:underline">
                      {p.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{p.member ? p.member.name : <span className="text-muted-foreground">Template</span>}</TableCell>
                  <TableCell className="text-sm">{p.trainer}</TableCell>
                  <TableCell className="tabular-nums">{p.dayCount}</TableCell>
                  <TableCell>
                    <Badge variant={PLAN_STATUS[p.status].variant}>{PLAN_STATUS[p.status].label}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(new Date(p.updatedAt), ctx.gym.timezone)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
