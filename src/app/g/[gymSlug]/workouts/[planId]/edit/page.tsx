import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { NotFoundError } from "@/server/errors";
import { getPlan } from "@/server/services/fitness/workouts";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { PlanEditor } from "../../plan-editor";

export const metadata: Metadata = { title: "Edit workout plan" };

export default async function EditPlanPage({ params }: { params: Promise<{ gymSlug: string; planId: string }> }) {
  const { gymSlug, planId } = await params;
  const ctx = await requireGymAccess(gymSlug);
  if (!hasPermission(ctx, "workouts.manage") || !ctx.access.writable || ctx.supportSessionId) return <AccessDenied what="editing workout plans" />;
  const plan = await getPlan(ctx, planId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (!plan.canEdit) return <AccessDenied what="editing this plan (only its trainer or a manager can)" />;
  return (
    <>
      <Link href={`/g/${gymSlug}/workouts/${plan.id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {plan.title}
      </Link>
      <PageHeader title="Edit plan" description={plan.member ? `For ${plan.member.name}. Days keep their history when you rename them or change exercises.` : "Template."} />
      <Card>
        <CardContent>
          <PlanEditor
            gymSlug={gymSlug}
            planId={plan.id}
            initial={{
              title: plan.title,
              notes: plan.notes ?? "",
              status: plan.status,
              days: plan.days.map((d) => ({
                title: d.title,
                exercises: d.exercises.map((e) => ({ name: e.name, sets: e.sets?.toString() ?? "", reps: e.reps ?? "", restSeconds: e.restSeconds?.toString() ?? "", notes: e.notes ?? "" })),
              })),
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
