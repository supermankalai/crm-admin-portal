import "server-only";
import { applyPayment, canVoid, validateRefund } from "@/domain/billing";
import { addDays, toDateString } from "@/domain/dates";
import { invoiceTotals } from "@/domain/money";
import type { Tx } from "@/server/db/context";
import { recordAudit } from "@/server/audit/tenant-audit";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { todayFor } from "../members/shared";
import { billingRule, mapRefundGuard } from "./shared";

/** Record a payment against an open invoice. The invoice row is locked, so concurrent payments can't overpay. */
export async function recordPayment(
  ctx: TenantContext,
  input: { invoiceId: string; amount: number; method: "CASH" | "CARD" | "TRANSFER"; reference: string | null },
  meta: RequestMeta
) {
  assertCan(ctx, "payments.record");
  if (!ctx.staffId) throw new ValidationError("Only staff can record payments.");
  const staffId = ctx.staffId;
  return inTenant(ctx, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} AND "deletedAt" IS NULL FOR UPDATE`;
    if (!locked.length) throw new NotFoundError("Invoice not found.");
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
    const applied = billingRule(() =>
      applyPayment({ totalMinor: invoice.totalMinor, amountPaidMinor: invoice.amountPaidMinor, status: invoice.status, dueDate: toDateString(invoice.dueDate) }, input.amount)
    );
    const payment = await tx.payment.create({
      data: {
        gymId: ctx.gym.id,
        memberId: invoice.memberId,
        invoiceId: invoice.id,
        amountMinor: input.amount,
        currency: invoice.currency,
        method: input.method,
        reference: input.reference,
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
    await recordAudit(tx, ctx, { action: "payment.record", entityType: "Payment", entityId: payment.id, changes: { amountMinor: input.amount, method: input.method, invoiceId: invoice.id, invoicePaid: applied.fullyPaid } }, meta);
    return { paymentId: payment.id, ...applied };
  });
}

/**
 * Refund all or part of a payment. Optionally cancel the membership it paid for — in the same
 * transaction, so money and membership status never disagree. The DB trigger enforce_refund_total
 * re-checks the limit and updates Payment.status.
 */
export async function refundPayment(
  ctx: TenantContext,
  input: { paymentId: string; amount: number; reason: string; cancelMembership: boolean },
  meta: RequestMeta
) {
  assertCan(ctx, "payments.refund");
  if (!ctx.staffId) throw new ValidationError("Only staff can issue refunds.");
  const staffId = ctx.staffId;
  const today = todayFor(ctx);
  try {
    return await inTenant(ctx, async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Payment" WHERE id = ${input.paymentId} AND "deletedAt" IS NULL FOR UPDATE`;
      if (!locked.length) throw new NotFoundError("Payment not found.");
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
        include: { refunds: { select: { amountMinor: true } }, invoice: { select: { membershipId: true } } },
      });
      const refunded = payment.refunds.reduce((s, r) => s + r.amountMinor, 0);
      const outcome = billingRule(() => validateRefund(payment, refunded, input.amount));

      const refund = await tx.refund.create({
        data: { gymId: ctx.gym.id, paymentId: payment.id, amountMinor: input.amount, reason: input.reason, refundedAt: new Date(), recordedById: staffId },
        select: { id: true },
      });

      let cancelledMembershipId: string | null = null;
      const membershipId = payment.invoice?.membershipId;
      if (input.cancelMembership && membershipId) {
        const m = await tx.membership.findUnique({ where: { id: membershipId }, select: { id: true, status: true, startDate: true, endDate: true } });
        if (m && m.status !== "CANCELLED") {
          const start = toDateString(m.startDate);
          const end = toDateString(m.endDate);
          const newEnd = start > today ? start : end < today ? end : today;
          await tx.membership.update({
            where: { id: m.id },
            data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `Refunded: ${input.reason}`, endDate: new Date(`${newEnd}T00:00:00Z`) },
            select: { id: true },
          });
          await recordAudit(tx, ctx, { action: "membership.cancel", entityType: "Membership", entityId: m.id, changes: { viaRefund: refund.id, endDate: { from: end, to: newEnd } } }, meta);
          cancelledMembershipId = m.id;
        }
      }
      await recordAudit(tx, ctx, { action: "payment.refund", entityType: "Payment", entityId: payment.id, changes: { refundId: refund.id, amountMinor: input.amount, status: outcome.status, cancelledMembershipId } }, meta);
      return { refundId: refund.id, ...outcome, cancelledMembershipId };
    });
  } catch (error) {
    mapRefundGuard(error);
  }
}

/** Void an unpaid invoice (e.g. sold by mistake). The unpaid membership it created is cancelled with it. */
export async function voidInvoice(ctx: TenantContext, invoiceId: string, reason: string, meta: RequestMeta) {
  assertCan(ctx, "payments.refund");
  return inTenant(ctx, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Invoice" WHERE id = ${invoiceId} AND "deletedAt" IS NULL FOR UPDATE`;
    if (!locked.length) throw new NotFoundError("Invoice not found.");
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { id: true, status: true, amountPaidMinor: true, membershipId: true, description: true } });
    if (!canVoid(invoice)) throw new ValidationError(invoice.amountPaidMinor > 0 ? "Invoices with payments can't be voided — refund the payment instead." : "Only open invoices can be voided.");
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "VOID" }, select: { id: true } });
    const isMembershipSale = invoice.membershipId && !invoice.description?.startsWith("Cancellation fee");
    if (isMembershipSale) {
      await tx.membership.update({
        where: { id: invoice.membershipId! },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `Invoice voided: ${reason}` },
        select: { id: true },
      });
    }
    await recordAudit(tx, ctx, { action: "invoice.void", entityType: "Invoice", entityId: invoiceId, changes: { reason, cancelledMembership: isMembershipSale ? invoice.membershipId : null } }, meta);
  });
}

/** Invoice a membership cancellation fee (called inside the cancellation transaction). */
export async function invoiceCancellationFee(
  tx: Tx,
  ctx: TenantContext,
  args: { memberId: string; membershipId: string; planName: string; feeMinor: number; number: number }
) {
  const totals = invoiceTotals(args.feeMinor, ctx.gym.taxRateBps);
  return tx.invoice.create({
    data: {
      gymId: ctx.gym.id,
      number: args.number,
      description: `Cancellation fee — ${args.planName}`,
      memberId: args.memberId,
      membershipId: args.membershipId,
      currency: ctx.gym.currency,
      ...totals,
      issuedAt: new Date(),
      dueDate: new Date(`${addDays(todayFor(ctx), 7)}T00:00:00Z`),
    },
    select: { id: true, number: true },
  });
}
