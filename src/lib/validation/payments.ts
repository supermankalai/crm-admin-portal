import { z } from "zod";
import { isDateString } from "@/domain/dates";
import { parseMajorToMinor } from "@/domain/money";

const id = z.string().trim().min(1).max(64);

const amount = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const minor = parseMajorToMinor(v);
    if (minor === null || minor <= 0) {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 2500 or 2500.50" });
      return z.NEVER;
    }
    return minor;
  });

export const PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER"] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = { CASH: "Cash", CARD: "Card", TRANSFER: "Bank transfer / UPI" };

const reference = z
  .string()
  .trim()
  .max(80)
  .transform((v) => (v === "" ? null : v));

const paymentFields = {
  method: z.enum(PAYMENT_METHODS),
  reference,
};

export const recordPaymentSchema = z
  .object({ invoiceId: id, amount, ...paymentFields })
  .refine((p) => p.method !== "TRANSFER" || p.reference !== null, { path: ["reference"], message: "Add the transfer / UPI reference" });

export const sellMembershipSchema = z
  .object({
    memberId: id,
    planId: id,
    startDate: z.string().trim().refine(isDateString, "Choose a start date"),
    payNow: z.enum(["full", "partial", "none"]),
    amount: z.string().trim(),
    ...paymentFields,
  })
  .superRefine((v, ctx) => {
    if (v.payNow === "partial") {
      const minor = parseMajorToMinor(v.amount);
      if (minor === null || minor <= 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter the amount received" });
    }
    if (v.payNow !== "none" && v.method === "TRANSFER" && v.reference === null) {
      ctx.addIssue({ code: "custom", path: ["reference"], message: "Add the transfer / UPI reference" });
    }
  })
  .transform((v) => ({ ...v, amountMinor: v.payNow === "partial" ? (parseMajorToMinor(v.amount) as number) : null }));

export const refundSchema = z.object({
  paymentId: id,
  amount,
  reason: z.string().trim().min(3, "Give a reason").max(300),
  cancelMembership: z.boolean().default(false),
});

export const voidInvoiceSchema = z.object({ invoiceId: id, reason: z.string().trim().min(3, "Give a reason").max(300) });

export const checkInSchema = z.object({
  memberId: id,
  locationId: id,
  method: z.enum(["NAME_SEARCH", "MEMBER_ID", "QR"]),
});

export const checkInLookupSchema = z.object({ query: z.string().trim().min(1).max(100) });

export type SellMembershipInput = z.output<typeof sellMembershipSchema>;
export type SellMembershipFormValues = z.input<typeof sellMembershipSchema>;
