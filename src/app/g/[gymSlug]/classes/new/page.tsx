import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listClassSetup } from "@/server/services/classes/setup";
import { todayFor } from "@/server/services/members/shared";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { SessionForm } from "./session-form";

export const metadata: Metadata = { title: "Schedule class" };

export default async function NewSessionPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "classes.manage")) return <AccessDenied what="scheduling classes" />;
  if (!ctx.access.writable || ctx.supportSessionId) return <AccessDenied what="scheduling classes while the gym is read-only" />;
  const setup = await listClassSetup(ctx);
  const ready = setup.classTypes.length && setup.rooms.length && setup.trainers.length;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Schedule a class" description="Trainer and room double-booking is checked automatically." />
      {ready ? (
        <SessionForm gymSlug={ctx.gym.slug} setup={setup} today={todayFor(ctx)} />
      ) : (
        <Card>
          <EmptyState
            title="Set up class types and rooms first"
            description="You need at least one class type, one room and one trainer."
            action={
              <Button asChild>
                <Link href={`/g/${ctx.gym.slug}/classes/setup`}>Class types &amp; rooms</Link>
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}
