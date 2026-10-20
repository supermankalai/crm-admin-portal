import "server-only";
import { applyPayment, BillingRuleError } from "@/domain/billing";
import type { DateString } from "@/domain/dates";
import { recordAudit } from "@/server/audit/tenant-audit";
import type { Tx } from "@/server/db/context";
import { ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import type { TenantContext } from "@/server/tenant/types";

export async function nextInvoiceNumber(tx: Tx, ctx: TenantContext): Promise<number> {
  const counter = await tx.gymCounter.update({
    where: { gymId_key: { gymId: ctx.gym.id, key: "invoice" } },
    data: { value: { increment: 1 } },
    select: { value: true },
  });
  return counter.value;
}

/** Translate rule and database guard errors into friendly validation errors. */
export function billingRule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof BillingRuleError) throw new ValidationError(error.message);
    throw error;
  }
}

export function mapRefundGuard(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("refund:exceeds_payment")) throw new ValidationError("A refund cannot be more than the amount still refundable on this payment.");
  if (message.includes("refund:payment_void")) throw new ValidationError("This payment was voided and cannot be refunded.");
  throw error;
}

export type PayAtSale = { payNow: "full" | "partial" | "none"; amountMinor: number | null; method: "CASH" | "CARD" | "TRANSFER"; reference: string | null };

/**
 * Take payment on a just-issued invoice (a sale): the full amount, part of it, or nothing yet.
 * Runs inside the sale's transaction. Returns the amount paid.
 */
export async function payAtSale(
  tx: Tx,
  ctx: TenantContext,
  staffId: string,
  invoice: { id: string; memberId: string; totalMinor: number; dueDate: DateString },
  pay: PayAtSale,
  meta: RequestMeta
): Promise<number> {
  if (pay.payNow === "none") return 0;
  const amount = pay.payNow === "full" ? invoice.totalMinor : pay.amountMinor!;
  const applied = billingRule(() => applyPayment({ totalMinor: invoice.totalMinor, amountPaidMinor: 0, status: "OPEN", dueDate: invoice.dueDate }, amount));
  const payment = await tx.payment.create({
    data: {
      gymId: ctx.gym.id,
      memberId: invoice.memberId,
      invoiceId: invoice.id,
      amountMinor: amount,
      currency: ctx.gym.currency,
      method: pay.method,
      reference: pay.reference,
      receivedAt: new Date(),
      recordedById: staffId,
    },
    select: { id: true },
  });
  await tx.invoice.update({
    where: { id: invoice.id },
    data: { amountPaidMinor: applied.amountPaidMinor, status: applied.status, paidAt: applied.fullyPaid ? new Date() : null },
    select: { id: true },
  });
  await recordAudit(tx, ctx, { action: "payment.record", entityType: "Payment", entityId: payment.id, changes: { amountMinor: amount, method: pay.method, invoiceId: invoice.id } }, meta);
  return amount;
}
