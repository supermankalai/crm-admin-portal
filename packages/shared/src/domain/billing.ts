import { addDays, type DateString } from "./dates";
import { invoiceTotals } from "./money";

/**
 * Member billing rules (gym ↔ member). Integer minor units throughout. Pure functions.
 */

export class BillingRuleError extends Error {}

export type InvoiceAmounts = { totalMinor: number; amountPaidMinor: number; status: "OPEN" | "PAID" | "VOID"; dueDate: DateString };

export function outstanding(inv: Pick<InvoiceAmounts, "totalMinor" | "amountPaidMinor">): number {
  return Math.max(inv.totalMinor - inv.amountPaidMinor, 0);
}

export function isOverdue(inv: InvoiceAmounts, today: DateString): boolean {
  return inv.status === "OPEN" && outstanding(inv) > 0 && inv.dueDate < today;
}

/** Apply a payment to an invoice: never more than what is outstanding. */
export function applyPayment(inv: InvoiceAmounts, amountMinor: number) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new BillingRuleError("Enter an amount greater than zero.");
  if (inv.status === "VOID") throw new BillingRuleError("This invoice has been voided.");
  if (inv.status === "PAID") throw new BillingRuleError("This invoice is already paid.");
  const due = outstanding(inv);
  if (amountMinor > due) throw new BillingRuleError("The amount is more than what is still owed on this invoice.");
  const amountPaidMinor = inv.amountPaidMinor + amountMinor;
  const paid = amountPaidMinor === inv.totalMinor;
  return { amountPaidMinor, status: paid ? ("PAID" as const) : ("OPEN" as const), fullyPaid: paid, remainingMinor: inv.totalMinor - amountPaidMinor };
}

/** How much of a payment can still be refunded. */
export function refundable(payment: { amountMinor: number; status: string }, refundedMinor: number): number {
  if (payment.status === "VOID") return 0;
  return Math.max(payment.amountMinor - refundedMinor, 0);
}

export function validateRefund(payment: { amountMinor: number; status: string }, refundedMinor: number, amountMinor: number) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new BillingRuleError("Enter a refund amount greater than zero.");
  const max = refundable(payment, refundedMinor);
  if (max === 0) throw new BillingRuleError("This payment has already been fully refunded.");
  if (amountMinor > max) throw new BillingRuleError("A refund cannot be more than the amount still refundable on this payment.");
  const total = refundedMinor + amountMinor;
  return { fullyRefunded: total === payment.amountMinor, status: total === payment.amountMinor ? ("REFUNDED" as const) : ("PARTIALLY_REFUNDED" as const) };
}

export function canVoid(inv: Pick<InvoiceAmounts, "status" | "amountPaidMinor">): boolean {
  return inv.status === "OPEN" && inv.amountPaidMinor === 0;
}

/**
 * When a sold membership starts: today, or — for a renewal — the day after the member's latest
 * active membership ends, so renewing early never loses paid days.
 */
export function renewalStartDate(today: DateString, latestActiveEnd: DateString | null): DateString {
  if (latestActiveEnd && latestActiveEnd >= today) return addDays(latestActiveEnd, 1);
  return today;
}

export type MembershipSale = {
  startDate: DateString;
  endDate: DateString;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  dueDate: DateString;
  classCredits: number | null;
};

/** Price a membership sale from the plan (price snapshot + gym tax rate). */
export function priceMembershipSale(
  plan: { priceMinor: number; durationDays: number; classCredits: number | null },
  taxRateBps: number,
  startDate: DateString,
  today: DateString,
  paymentTermsDays = 7
): MembershipSale {
  const totals = invoiceTotals(plan.priceMinor, taxRateBps);
  return {
    startDate,
    endDate: addDays(startDate, plan.durationDays - 1),
    ...totals,
    dueDate: addDays(today, paymentTermsDays),
    classCredits: plan.classCredits,
  };
}

export function formatInvoiceNumber(n: number): string {
  return `INV-${String(n).padStart(6, "0")}`;
}
