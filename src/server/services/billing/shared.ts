import "server-only";
import { BillingRuleError } from "@/domain/billing";
import type { Tx } from "@/server/db/context";
import { ValidationError } from "@/server/errors";
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
