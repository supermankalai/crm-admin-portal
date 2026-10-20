import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotFoundError } from "@/server/errors";
import { trainerClients } from "@/server/services/fitness/trainer";
import { getPlan } from "@/server/services/fitness/workouts";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { PLAN_STATUS } from "../plan-shared";
import { AssignPlan, StatusButtons } from "../plan-controls";

export const metadata: Metadata = { title: "Workout plan" };

const restText = (s: number) => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);

export default async function PlanPage({ params }: { params: Promise<{ gymSlug: string; planId: string }> }) {
  const { gymSlug, planId } = await params;
  const ctx = await requireGymAccess(gymSlug);
  if (!hasPermission(ctx, "workouts.manage")) return <AccessDenied what="workout plans" />;
  const plan = await getPlan(ctx, planId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const canWrite = ctx.access.writable && !ctx.supportSessionId;
  const { clients } = await trainerClients(ctx);
  const base = `/g/${gymSlug}/workouts`;

  return (
    <>
      <Link href={base} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Workout plans
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{plan.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={PLAN_STATUS[plan.status].variant}>{PLAN_STATUS[plan.status].label}</Badge>
            <span>{plan.member ? <>For <Link href={`/g/${gymSlug}/members/${plan.member.id}`} className="hover:underline">{plan.member.name}</Link></> : "Template"}</span>
            <span>· by {plan.trainer}</span>
          </div>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {plan.canEdit && (
              <>
                <Button asChild>
                  <Link href={`${base}/${plan.id}/edit`}>
                    <Pencil aria-hidden /> Edit
                  </Link>
                </Button>
                <StatusButtons gymSlug={gymSlug} planId={plan.id} status={plan.status} />
              </>
            )}
            <AssignPlan gymSlug={gymSlug} planId={plan.id} clients={clients.map((c) => ({ memberId: c.memberId, name: c.name }))} />
          </div>
        )}
      </div>
      {plan.notes && <p className="mb-4 max-w-prose whitespace-pre-wrap text-sm">{plan.notes}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {plan.days.map((d) => (
          <Card key={d.id}>
            <CardHeader>
              <CardTitle>{d.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid list-decimal gap-2 pl-5 text-sm">
                {d.exercises.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">{e.name}</span>
                    <span className="text-muted-foreground">
                      {e.sets ? ` · ${e.sets} × ${e.reps ?? "—"}` : e.reps ? ` · ${e.reps}` : ""}
                      {e.restSeconds ? ` · rest ${restText(e.restSeconds)}` : ""}
                    </span>
                    {e.notes && <span className="block text-xs text-muted-foreground">{e.notes}</span>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
