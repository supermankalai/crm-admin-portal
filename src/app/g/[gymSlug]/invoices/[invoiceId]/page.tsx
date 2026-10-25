import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canVoid, formatInvoiceNumber } from "@/domain/billing";
import { formatDate, formatDateTime, toDateString } from "@/domain/dates";
import { formatMemberNumber } from "@/domain/member-search";
import { formatMoney } from "@/domain/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/payments";
import { NotFoundError } from "@/server/errors";
import { getInvoice } from "@/server/services/billing/queries";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { PrintButton, RecordPaymentButton, RefundButton, VoidInvoiceButton } from "./invoice-actions";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ gymSlug: string; invoiceId: string }> }) {
  const { gymSlug, invoiceId } = await params;
  const ctx = await requireGymAccess(gymSlug);
  if (!hasPermission(ctx, "payments.view")) return <AccessDenied what="invoices" />;
  const { invoice, gym, payments } = await getInvoice(ctx, invoiceId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const money = (v: number) => formatMoney(v, invoice.currency);
  const refundedMinor = payments.reduce((s, p) => s + p.refundedMinor, 0);
  const writable = ctx.access.writable && !ctx.supportSessionId;
  const tz = ctx.gym.timezone;
  const statusBadge = invoice.overdue ? (
    <Badge variant="danger">Overdue</Badge>
  ) : (
    <Badge variant={invoice.status === "PAID" ? "success" : invoice.status === "VOID" ? "secondary" : "warning"}>{invoice.status === "OPEN" ? "Open" : invoice.status === "PAID" ? "Paid" : "Void"}</Badge>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/g/${gymSlug}/payments?view=invoices`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Invoices
        </Link>
        <div className="flex flex-wrap gap-2">
          <PrintButton />
          {writable && invoice.status === "OPEN" && hasPermission(ctx, "payments.record") && (
            <RecordPaymentButton gymSlug={gymSlug} invoiceId={invoice.id} outstandingMinor={invoice.outstandingMinor} currency={invoice.currency} />
          )}
          {writable && canVoid(invoice) && hasPermission(ctx, "payments.refund") && (
            <VoidInvoiceButton gymSlug={gymSlug} invoiceId={invoice.id} isMembershipSale={!!invoice.membershipId && !invoice.description?.startsWith("Cancellation fee")} />
          )}
        </div>
      </div>

      <Card className="print:border-0 print:shadow-none">
        <CardContent className="grid gap-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-lg font-bold">{gym.name}</p>
              {gym.address && <p className="text-sm text-muted-foreground">{gym.address}</p>}
              <p className="text-sm text-muted-foreground">{[gym.email, gym.phone].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="text-right">
              <h1 className="font-mono text-xl font-bold">{formatInvoiceNumber(invoice.number)}</h1>
              <div className="mt-1 flex justify-end gap-1">
                {statusBadge}
                {refundedMinor > 0 && <Badge variant="danger">{refundedMinor >= invoice.amountPaidMinor ? "Refunded" : "Part refunded"}</Badge>}
              </div>
            </div>
          </header>

          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Billed to</p>
              <Link href={`/g/${gymSlug}/members/${invoice.member.id}`} className="font-medium hover:underline print:no-underline">
                {invoice.member.firstName} {invoice.member.lastName}
              </Link>
              <p className="font-mono text-xs">{formatMemberNumber(invoice.member.memberNumber)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Issued</p>
              <p>{formatDate(invoice.issuedAt, tz)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Due</p>
              <p>{formatDate(invoice.dueDate)}</p>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="hover:bg-transparent">
                <TableCell className="whitespace-normal">
                  {invoice.description ?? "Membership"}
                  {invoice.membership && (
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(toDateString(invoice.membership.startDate))} – {formatDate(toDateString(invoice.membership.endDate))}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(invoice.subtotalMinor)}</TableCell>
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableCell className="text-muted-foreground">Tax ({(gym.taxRateBps / 100).toFixed(2)}%)</TableCell>
                <TableCell className="text-right tabular-nums">{money(invoice.taxMinor)}</TableCell>
              </TableRow>
              <TableRow className="font-semibold hover:bg-transparent">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{money(invoice.totalMinor)}</TableCell>
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableCell className="text-muted-foreground">Paid</TableCell>
                <TableCell className="text-right tabular-nums">{money(invoice.amountPaidMinor)}</TableCell>
              </TableRow>
              {refundedMinor > 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="text-muted-foreground">Refunded</TableCell>
                  <TableCell className="text-right text-red-700 tabular-nums dark:text-red-400">−{money(refundedMinor)}</TableCell>
                </TableRow>
              )}
              {invoice.status === "OPEN" && (
                <TableRow className="font-semibold hover:bg-transparent">
                  <TableCell>Balance due</TableCell>
                  <TableCell className="text-right tabular-nums">{money(invoice.outstandingMinor)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <section aria-labelledby="payments-heading">
            <h2 id="payments-heading" className="mb-2 text-sm font-semibold">
              Payments
            </h2>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments yet.</p>
            ) : (
              <ul className="grid gap-2">
                {payments.map((p) => (
                  <li key={p.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium tabular-nums">{money(p.amountMinor)}</span> · {PAYMENT_METHOD_LABELS[p.method]}
                        {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {formatDateTime(p.receivedAt, tz)} · {p.recordedBy}
                        {writable && p.refundableMinor > 0 && hasPermission(ctx, "payments.refund") && (
                          <RefundButton gymSlug={gymSlug} invoiceId={invoice.id} paymentId={p.id} refundableMinor={p.refundableMinor} currency={p.currency} hasMembership={!!invoice.membershipId} />
                        )}
                      </span>
                    </div>
                    {p.refunds.map((r) => (
                      <p key={r.id} className="mt-1 text-xs text-red-700 dark:text-red-400">
                        Refunded {money(r.amountMinor)} on {formatDate(r.refundedAt, tz)} — {r.reason}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
