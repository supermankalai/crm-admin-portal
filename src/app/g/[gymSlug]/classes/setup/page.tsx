import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listClassSetup } from "@/server/services/classes/setup";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { ClassTypeDialog, RoomDialog } from "./setup-dialogs";

export const metadata: Metadata = { title: "Class types & rooms" };

export default async function ClassSetupPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "classes.manage")) return <AccessDenied what="class setup" />;
  const setup = await listClassSetup(ctx);
  const slug = ctx.gym.slug;
  const writable = ctx.access.writable && !ctx.supportSessionId;

  return (
    <>
      <Link href={`/g/${slug}/classes`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Timetable
      </Link>
      <PageHeader title="Class types & rooms" description="What you teach, and where." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Class types</CardTitle>
            {writable && <ClassTypeDialog gymSlug={slug} />}
          </CardHeader>
          <CardContent>
            {setup.classTypes.length === 0 ? (
              <EmptyState title="No class types yet" />
            ) : (
              <ul className="divide-y">
                {setup.classTypes.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{t.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t.durationMinutes} min · {t.defaultCapacity} spots
                      </span>
                    </span>
                    {writable && (
                      <ClassTypeDialog
                        gymSlug={slug}
                        value={{ classTypeId: t.id, name: t.name, description: t.description ?? "", color: t.color, durationMinutes: t.durationMinutes, defaultCapacity: t.defaultCapacity }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Rooms</CardTitle>
            {writable && <RoomDialog gymSlug={slug} locations={setup.locations} />}
          </CardHeader>
          <CardContent>
            {setup.rooms.length === 0 ? (
              <EmptyState title="No rooms yet" />
            ) : (
              <ul className="divide-y">
                {setup.rooms.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.location.name} · holds {r.capacity}
                      </span>
                    </span>
                    {writable && <RoomDialog gymSlug={slug} locations={setup.locations} value={{ roomId: r.id, locationId: r.locationId, name: r.name, capacity: r.capacity }} />}
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
