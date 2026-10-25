import type { Metadata } from "next";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, isDateString } from "@/domain/dates";
import { AUDIT_CATEGORIES, describeAction, listAuditLog } from "@/server/services/audit-log";
import { hasPermission, requireGymAccess } from "@/server/tenant";

export const metadata: Metadata = { title: "Audit log" };

type Search = { category?: string; actor?: string; from?: string; to?: string; page?: string };

/** Compact one-line summary of a changes object: "price: 1000 → 1200, name: …". */
function summarise(changes: unknown): string {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return "";
  return Object.entries(changes as Record<string, unknown>)
    .map(([k, v]) => {
      if (v && typeof v === "object" && "from" in v && "to" in v) {
        const { from, to } = v as { from: unknown; to: unknown };
        return `${k}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join(", ");
}

export default async function AuditPage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<Search> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "audit.view")) return <AccessDenied what="the audit log" />;
  const sp = await searchParams;
  const filters = {
    category: AUDIT_CATEGORIES.some((c) => c.key === sp.category) ? sp.category : undefined,
    actorUserId: sp.actor && /^[\w-]{1,64}$/.test(sp.actor) ? sp.actor : undefined,
    from: sp.from && isDateString(sp.from) ? sp.from : undefined,
    to: sp.to && isDateString(sp.to) ? sp.to : undefined,
  };
  const result = await listAuditLog(ctx, { ...filters, page: Number(sp.page) || 1 });
  const base = `/g/${ctx.gym.slug}/audit`;

  return (
    <>
      <PageHeader title="Audit log" description="Who changed what, and when. Entries can't be edited or deleted. Personal details are redacted." />
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap items-end gap-3 border-b p-4" action={base}>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-category">What</Label>
            <NativeSelect id="audit-category" name="category" defaultValue={filters.category ?? ""} className="w-52">
              <option value="">Everything</option>
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-actor">Who</Label>
            <NativeSelect id="audit-actor" name="actor" defaultValue={filters.actorUserId ?? ""} className="w-52">
              <option value="">Anyone</option>
              {result.people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                  {p.removed ? " (removed)" : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-from">From</Label>
            <Input id="audit-from" name="from" type="date" defaultValue={filters.from} className="w-40" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-to">To</Label>
            <Input id="audit-to" name="to" type="date" defaultValue={filters.to} className="w-40" />
          </div>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No entries match these filters.
                </TableCell>
              </TableRow>
            )}
            {result.rows.map((r) => {
              const details = summarise(r.changes);
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-xs whitespace-nowrap">{formatDateTime(r.createdAt, ctx.gym.timezone)}</TableCell>
                  <TableCell className="text-sm">
                    {r.actor.name}
                    {r.actorType === "SUPPORT" && (
                      <Badge variant="warning" className="ml-1">
                        Support
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{describeAction(r.action)}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.action}</div>
                  </TableCell>
                  <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground" title={details}>
                    {details}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.ip ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} noun="entries" basePath={base} params={{ category: filters.category, actor: filters.actorUserId, from: filters.from, to: filters.to }} />
      </Card>
    </>
  );
}
