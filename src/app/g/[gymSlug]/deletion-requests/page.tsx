import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, UserX } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/domain/dates";
import { listDeletionRequests } from "@/server/services/deletion-requests";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { RequestActions } from "./request-actions";

export const metadata: Metadata = { title: "Deletion requests" };

const STATUS = { REQUESTED: { label: "Waiting", variant: "warning" }, COMPLETED: { label: "Erased", variant: "secondary" }, REJECTED: { label: "Rejected", variant: "outline" } } as const;

/** Members' requests (from the app) to delete their account and personal data. */
export default async function DeletionRequestsPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "members.delete")) return <AccessDenied what="deletion requests" />;
  const requests = await listDeletionRequests(ctx);
  const canWrite = ctx.access.writable && !ctx.supportSessionId;
  const tz = ctx.gym.timezone;

  return (
    <>
      <Link href={`/g/${ctx.gym.slug}/members`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Members
      </Link>
      <PageHeader title="Deletion requests" description="Members can ask, from the app, for their account and personal data to be deleted. Please handle each request promptly." />
      {requests.length === 0 ? (
        <Card>
          <EmptyState icon={<UserX />} title="No requests" description="Requests from the member app appear here, and owners and managers get a notification." />
        </Card>
      ) : (
        <div className="grid gap-3">
          {requests.map((r) => (
            <Card key={r.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid gap-1">
                    <CardTitle>
                      {r.status === "COMPLETED" ? (
                        r.member.name
                      ) : (
                        <Link href={`/g/${ctx.gym.slug}/members/${r.member.id}`} className="hover:underline">
                          {r.member.name}
                        </Link>
                      )}{" "}
                      <span className="font-mono text-sm font-normal text-muted-foreground">{r.member.memberNumber}</span>
                    </CardTitle>
                    <CardDescription>
                      Requested {formatDateTime(r.createdAt, tz)}
                      {r.resolvedAt && ` · ${STATUS[r.status].label.toLowerCase()} ${formatDateTime(r.resolvedAt, tz)}${r.resolvedBy ? ` by ${r.resolvedBy}` : ""}`}
                    </CardDescription>
                  </div>
                  <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                {r.reason && (
                  <p className="text-sm">
                    <span className="font-medium">Their reason: </span>
                    {r.reason}
                  </p>
                )}
                {r.resolutionNote && <p className="text-sm text-muted-foreground">Note: {r.resolutionNote}</p>}
                {r.status === "REQUESTED" && canWrite && <RequestActions gymSlug={ctx.gym.slug} requestId={r.id} memberName={r.member.name} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
