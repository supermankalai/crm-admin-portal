import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, FileText, Plus } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { LinkTabs } from "@/components/link-tabs";
import { Pagination } from "@/components/pagination";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInvoiceNumber } from "@/domain/billing";
import { formatDate, formatDateTime } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/validation/payments";
import { INVOICE_FILTERS, listInvoices, listPayments, type InvoiceFilter } from "@/server/services/billing/queries";
import { hasPermission, requireGymAccess, type TenantContext } from "@/server/tenant";

export const metadata: Metadata = { title: "Payments" };

type Search = { view?: string; from?: string; to?: string; method?: string; status?: string; page?: string };

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "danger" }> = {
  COMPLETED: { label: "Received", variant: "success" },
  PARTIALLY_REFUNDED: { label: "Part refunded", variant: "warning" },
  REFUNDED: { label: "Refunded", variant: "danger" },
  VOID: { label: "Void", variant: "secondary" },
};
const INVOICE_LABELS: Record<InvoiceFilter, string> = { open: "Open", overdue: "Overdue", paid: "Paid", void: "Void", all: "All" };

export default async function PaymentsPage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<Search> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "payments.view")) return <AccessDenied what="payments" />;
  const sp = await searchParams;
  const view = sp.view === "invoices" ? "invoices" : "payments";
  const base = `/g/${ctx.gym.slug}/payments`;
  const money = (v: number) => formatMoney(v, ctx.gym.currency);
  const canSell = hasPermission(ctx, "payments.record") && ctx.access.writable && !ctx.supportSessionId;
  const tz = ctx.gym.timezone;

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received, invoices and what is still owed."
        actions={
          canSell && (
            <Button asChild>
              <Link href={`${base}/sell`}>
                <Plus aria-hidden /> Sell membership
              </Link>
            </Button>
          )
        }
      />
      <LinkTabs
        label="Payments views"
        active={view}
        tabs={[
          { key: "payments", label: "Payments", href: base },
          { key: "invoices", label: "Invoices", href: `${base}?view=invoices` },
        ]}
      />
      <div className="mt-4">
        {view === "payments" ? <PaymentsView ctx={ctx} sp={sp} money={money} tz={tz} base={base} /> : <InvoicesView ctx={ctx} sp={sp} money={money} base={base} />}
      </div>
    </>
  );
}

async function PaymentsView({ ctx, sp, money, tz, base }: { ctx: TenantContext; sp: Search; money: (v: number) => string; tz: string; base: string }) {
  const ctxSlug = ctx.gym.slug;
  const method = (PAYMENT_METHODS as readonly string[]).includes(sp.method ?? "") ? (sp.method as (typeof PAYMENT_METHODS)[number]) : undefined;
  const result = await listPayments(ctx, { from: sp.from, to: sp.to, method, page: Number(sp.page) || 1 });
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Received" value={money(result.totals.grossMinor)} hint={`${formatDate(result.from)} – ${formatDate(result.to)}`} />
        <StatTile label="Refunded" value={money(result.totals.refundsMinor)} />
        <StatTile label="Net" value={money(result.totals.netMinor)} />
        <StatTile label="By method" value={<span className="text-sm font-medium">{PAYMENT_METHODS.map((m) => `${PAYMENT_METHOD_LABELS[m].split(" ")[0]} ${money(result.totals.byMethod[m] ?? 0)}`).join(" · ")}</span>} />
      </div>
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="grid gap-1">
            <Label htmlFor="from" className="text-xs">From</Label>
            <Input id="from" name="from" type="date" defaultValue={result.from} className="w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="to" className="text-xs">To</Label>
            <Input id="to" name="to" type="date" defaultValue={result.to} className="w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="method" className="text-xs">Method</Label>
            <NativeSelect id="method" name="method" defaultValue={method ?? ""} className="w-44">
              <option value="">All methods</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
        {result.rows.length === 0 ? (
          <EmptyState icon={<CreditCard />} title="No payments in this period" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Received</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs">
                    {formatDateTime(p.receivedAt, tz)}
                    <span className="block text-muted-foreground">by {p.recordedBy}</span>
                  </TableCell>
                  <TableCell>
                    <Link href={`/g/${ctxSlug}/members/${p.member.id}`} className="font-medium hover:underline">
                      {p.memberName}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">{p.memberNumber}</span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {p.invoice ? (
                      <Link href={`/g/${ctxSlug}/invoices/${p.invoice.id}`} className="hover:underline">
                        <span className="font-mono">{formatInvoiceNumber(p.invoice.number)}</span>
                        <span className="block text-muted-foreground">{p.invoice.description}</span>
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {PAYMENT_METHOD_LABELS[p.method]}
                    {p.reference && <span className="block text-muted-foreground">{p.reference}</span>}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {money(p.amountMinor)}
                    {p.refundedMinor > 0 && <span className="block text-xs text-muted-foreground">−{money(p.refundedMinor)}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} noun="payments" basePath={base} params={{ from: result.from, to: result.to, method }} />
      </Card>
    </div>
  );
}

async function InvoicesView({ ctx, sp, money, base }: { ctx: TenantContext; sp: Search; money: (v: number) => string; base: string }) {
  const ctxSlug = ctx.gym.slug;
  const status = (INVOICE_FILTERS as readonly string[]).includes(sp.status ?? "") ? (sp.status as InvoiceFilter) : "open";
  const result = await listInvoices(ctx, { status, page: Number(sp.page) || 1 });
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <nav aria-label="Invoice status" className="flex flex-wrap gap-1">
          {INVOICE_FILTERS.map((f) => (
            <Button key={f} asChild size="sm" variant={f === status ? "default" : "outline"}>
              <Link href={`${base}?view=invoices&status=${f}`} aria-current={f === status ? "page" : undefined}>
                {INVOICE_LABELS[f]}
              </Link>
            </Button>
          ))}
        </nav>
        {(status === "open" || status === "overdue") && (
          <p className="text-sm">
            Outstanding: <span className="font-semibold tabular-nums">{money(result.outstandingMinor)}</span>
          </p>
        )}
      </div>
      {result.rows.length === 0 ? (
        <EmptyState icon={<FileText />} title={status === "overdue" ? "Nothing overdue" : "No invoices here"} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Invoice</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Outstanding</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Link href={`/g/${ctxSlug}/invoices/${i.id}`} className="font-mono font-medium hover:underline">
                    {formatInvoiceNumber(i.number)}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{i.description}</span>
                </TableCell>
                <TableCell>
                  <Link href={`/g/${ctxSlug}/members/${i.member.id}`} className="hover:underline">
                    {i.memberName}
                  </Link>
                  <span className="block font-mono text-xs text-muted-foreground">{i.memberNumber}</span>
                </TableCell>
                <TableCell className="tabular-nums">{money(i.totalMinor)}</TableCell>
                <TableCell className="tabular-nums">{i.status === "OPEN" ? money(i.outstandingMinor) : "—"}</TableCell>
                <TableCell className="text-xs">{formatDate(i.dueDate)}</TableCell>
                <TableCell>
                  {i.overdue ? <Badge variant="danger">Overdue</Badge> : <Badge variant={i.status === "PAID" ? "success" : i.status === "VOID" ? "secondary" : "warning"}>{i.status === "OPEN" ? "Open" : i.status === "PAID" ? "Paid" : "Void"}</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} noun="invoices" basePath={base} params={{ view: "invoices", status }} />
    </Card>
  );
}
