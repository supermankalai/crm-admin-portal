import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/server/platform/guard";
import { listPlatformAudit } from "@/server/platform/services";

export const metadata: Metadata = { title: "Audit log" };

const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium" });
const FILTERS = [
  ["", "All events"],
  ["auth.", "Sign-ins and sign-outs"],
  ["auth.login_failed", "Failed sign-ins"],
  ["gym.", "Gym sign-ups"],
  ["subscription.", "Subscription changes"],
  ["plan.", "Plan changes"],
  ["support.", "Support access"],
] as const;

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  const admin = await requirePlatformAdmin();
  const sp = await searchParams;
  const action = FILTERS.some(([v]) => v === sp.action) ? sp.action || undefined : undefined;
  const result = await listPlatformAudit(admin.id, { action, page: Number(sp.page) || 1 });

  return (
    <>
      <PageHeader title="Platform audit log" description="Append-only. Entries cannot be edited or deleted, even by the database owner role." />
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap items-end gap-2 border-b p-4">
          <NativeSelect name="action" defaultValue={action ?? ""} className="w-full sm:w-64" aria-label="Filter events">
            {FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>When</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Gym</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{dateTime.format(r.createdAt)}</TableCell>
                <TableCell className="font-mono text-xs">{r.action}</TableCell>
                <TableCell className="text-xs">{r.actor ? r.actor.email : <span className="text-muted-foreground">anonymous</span>}</TableCell>
                <TableCell className="text-xs">{r.gymSlug ?? "—"}</TableCell>
                <TableCell className="max-w-96 truncate font-mono text-xs text-muted-foreground" title={JSON.stringify(r.metadata)}>
                  {r.metadata && Object.keys(r.metadata as object).length ? JSON.stringify(r.metadata) : ""}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.ip ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} noun="events" basePath="/admin/audit" params={{ action }} />
      </Card>
    </>
  );
}
