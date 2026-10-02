import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/server/platform/guard";
import { listSupportSessions } from "@/server/platform/services";
import { EndSessionButton } from "./end-session-button";

export const metadata: Metadata = { title: "Support access" };

const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export default async function AdminSupportPage() {
  const admin = await requirePlatformAdmin();
  const sessions = await listSupportSessions(admin.id);
  return (
    <>
      <PageHeader title="Support access" description="Every time a super admin opened a gym's data, why, and for how long." />
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Gym</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No support sessions yet.
                </TableCell>
              </TableRow>
            )}
            {sessions.map((s) => {
              const active = s.isActive;
              return (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/admin/gyms/${s.gymId}`} className="font-medium hover:underline">
                      {s.gym.name}
                    </Link>
                  </TableCell>
                  <TableCell>{s.superAdmin.name}</TableCell>
                  <TableCell className="max-w-80 whitespace-normal">{s.reason}</TableCell>
                  <TableCell className="text-xs">{dateTime.format(s.startedAt)}</TableCell>
                  <TableCell>
                    {active ? (
                      <Badge variant="warning">Active until {dateTime.format(s.expiresAt)}</Badge>
                    ) : (
                      <Badge variant="secondary">{s.endedAt ? `Ended ${dateTime.format(s.endedAt)}` : "Expired"}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{active && s.superAdminId === admin.id && <EndSessionButton sessionId={s.id} />}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
