import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { PlanEditor } from "../plan-editor";
import { BLANK_PLAN } from "../plan-shared";

export const metadata: Metadata = { title: "New workout template" };

export default async function NewPlanPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "workouts.manage") || !ctx.access.writable || ctx.supportSessionId) return <AccessDenied what="new workout plans" />;
  return (
    <>
      <Link href={`/g/${ctx.gym.slug}/workouts`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Workout plans
      </Link>
      <PageHeader title="New template" description="Write it once, then give a copy to any of your clients." />
      <Card>
        <CardContent>
          <PlanEditor gymSlug={ctx.gym.slug} initial={{ ...BLANK_PLAN, status: "DRAFT" }} />
        </CardContent>
      </Card>
    </>
  );
}
