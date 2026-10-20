import type { Metadata } from "next";
import { Megaphone } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/domain/dates";
import { AUDIENCE_LABELS } from "@/lib/validation/announcements";
import { listGymAnnouncements } from "@/server/services/announcements";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { AnnouncementForm, DeleteAnnouncementButton } from "./announcement-form";

export const metadata: Metadata = { title: "Announcements" };

export default async function AnnouncementsPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "announcements.manage")) return <AccessDenied what="announcements" />;
  const items = await listGymAnnouncements(ctx);
  const canWrite = ctx.access.writable && !ctx.supportSessionId;

  return (
    <>
      <PageHeader title="Announcements" description="News for your members' app and your staff: opening hours, events, class changes." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {canWrite && (
          <Card>
            <CardHeader>
              <CardTitle>New announcement</CardTitle>
              <CardDescription>Appears in the app at once; phones with alerts on get a notification with the title.</CardDescription>
            </CardHeader>
            <CardContent>
              <AnnouncementForm gymSlug={ctx.gym.slug} />
            </CardContent>
          </Card>
        )}
        <div className="grid content-start gap-3">
          {items.length === 0 ? (
            <Card>
              <EmptyState icon={<Megaphone />} title="No announcements yet" description="Your first announcement will show up here and in the members' app." />
            </Card>
          ) : (
            items.map((a) => (
              <Card key={a.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="grid gap-1">
                      <CardTitle>{a.title}</CardTitle>
                      <CardDescription>
                        {formatDateTime(a.publishedAt, ctx.gym.timezone)} · by {a.createdBy.user.name}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{AUDIENCE_LABELS[a.audience]}</Badge>
                      {canWrite && <DeleteAnnouncementButton gymSlug={ctx.gym.slug} id={a.id} title={a.title} />}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm">{a.body}</p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </>
  );
}
