"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordPaymentSchema, refundSchema, sellMembershipSchema, voidInvoiceSchema } from "@/lib/validation/payments";
import { gymAction } from "@/server/actions/gym-action";
import { getRequestMeta } from "@/server/security/request-meta";
import { recordPayment, refundPayment, voidInvoice } from "@/server/services/billing/payments";
import { searchMembersForPicker } from "@/server/services/billing/queries";
import { sellMembership, suggestedStartDate } from "@/server/services/billing/sell";

const refresh = (slug: string, memberId?: string, invoiceId?: string) => {
  revalidatePath(`/g/${slug}/payments`);
  revalidatePath(`/g/${slug}/dashboard`);
  if (memberId) revalidatePath(`/g/${slug}/members/${memberId}`);
  if (invoiceId) revalidatePath(`/g/${slug}/invoices/${invoiceId}`);
};

export const sellMembershipAction = gymAction({ permission: "payments.record", schema: sellMembershipSchema, write: true }, async (ctx, input) => {
  const result = await sellMembership(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug, input.memberId, result.invoiceId);
  return result;
});

export const recordPaymentAction = gymAction({ permission: "payments.record", schema: recordPaymentSchema, write: true }, async (ctx, input) => {
  const result = await recordPayment(ctx, { invoiceId: input.invoiceId, amount: input.amount, method: input.method, reference: input.reference }, await getRequestMeta());
  refresh(ctx.gym.slug, undefined, input.invoiceId);
  return result;
});

export const refundPaymentAction = gymAction({ permission: "payments.refund", schema: refundSchema.extend({ invoiceId: z.string().max(64).optional() }), write: true }, async (ctx, input) => {
  const result = await refundPayment(ctx, { paymentId: input.paymentId, amount: input.amount, reason: input.reason, cancelMembership: input.cancelMembership }, await getRequestMeta());
  refresh(ctx.gym.slug, undefined, input.invoiceId);
  return result!;
});

export const voidInvoiceAction = gymAction({ permission: "payments.refund", schema: voidInvoiceSchema, write: true }, async (ctx, input) => {
  await voidInvoice(ctx, input.invoiceId, input.reason, await getRequestMeta());
  refresh(ctx.gym.slug, undefined, input.invoiceId);
  return { voided: true };
});

/** Member picker search (read-only; allowed in read-only mode). */
export const searchMembersAction = gymAction({ permission: "members.view", schema: z.object({ q: z.string().trim().min(1).max(100) }), write: false }, (ctx, { q }) =>
  searchMembersForPicker(ctx, q)
);

export const suggestStartDateAction = gymAction({ permission: "payments.record", schema: z.object({ memberId: z.string().min(1).max(64) }), write: false }, (ctx, { memberId }) =>
  suggestedStartDate(ctx, memberId)
);
