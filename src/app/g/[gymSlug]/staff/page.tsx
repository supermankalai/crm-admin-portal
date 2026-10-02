import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/domain/dates";
import { assignableRoles, ROLE_LABELS } from "@/domain/permissions";
import { listStaff } from "@/server/services/staff";
import { getUsage } from "@/server/plan/limits";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { InviteDialog } from "./invite-dialog";
import { RevokeInvitationButton } from "./revoke-button";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "staff.view")) return <AccessDenied what="staff" />;
  const [{ staff, invitations }, usage] = await Promise.all([listStaff(ctx), getUsage(ctx)]);
  const writable = ctx.access.writable && !ctx.supportSessionId;
  const canInvite = writable && hasPermission(ctx, "staff.invite");
  const tz = ctx.gym.timezone;

  return (
    <>
      <PageHeader
        title="Staff"
        description={`${usage.staff.used} of ${usage.staff.limit} staff accounts on your plan${invitations.length ? ` · ${invitations.length} invitation(s) pending` : ""}.`}
        actions={canInvite && <InviteDialog gymSlug={ctx.gym.slug} roles={assignableRoles(ctx.role)} canManageBilling={hasPermission(ctx, "billing.manage")} />}
      />
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Clients</TableHead>
              <TableHead>Upcoming classes</TableHead>
              <TableHead>Last sign-in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link href={`/g/${ctx.gym.slug}/staff/${s.id}`} className="font-medium hover:underline">
                    {s.user.name}
                  </Link>
                  {s.title && <span className="block text-xs text-muted-foreground">{s.title}</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={s.role === "OWNER" ? "default" : "secondary"}>{ROLE_LABELS[s.role]}</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  <span className="block">{s.user.email}</span>
                  <span className="block text-muted-foreground">{s.phone ?? ""}</span>
                </TableCell>
                <TableCell className="tabular-nums">{s.role === "TRAINER" ? s._count.clients : "—"}</TableCell>
                <TableCell className="tabular-nums">{s._count.classesTaught || "—"}</TableCell>
                <TableCell className="text-xs">{s.user.lastLoginAt ? formatDateTime(s.user.lastLoginAt, tz) : "Never"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {invitations.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{i.email}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ROLE_LABELS[i.role]} · invited by {i.invitedBy.user.name} · expires {formatDate(i.expiresAt, tz)}
                    </span>
                  </span>
                  {canInvite && <RevokeInvitationButton gymSlug={ctx.gym.slug} invitationId={i.id} email={i.email} />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
