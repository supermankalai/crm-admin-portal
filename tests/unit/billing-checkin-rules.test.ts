import { describe, expect, it } from "vitest";
import {
  applyPayment,
  BillingRuleError,
  canVoid,
  formatInvoiceNumber,
  isOverdue,
  outstanding,
  priceMembershipSale,
  refundable,
  renewalStartDate,
  validateRefund,
} from "@/domain/billing";
import { evaluateCheckIn, parseCheckInQuery } from "@/domain/checkin";
import type { MembershipRecord } from "@/domain/membership";
import { recordPaymentSchema, sellMembershipSchema } from "@/lib/validation/payments";

const TODAY = "2026-10-02";
const invoice = (over = {}) => ({ totalMinor: 796_500, amountPaidMinor: 0, status: "OPEN" as const, dueDate: "2026-10-09", ...over });

describe("invoices and payments", () => {
  it("applies full and part payments", () => {
    expect(applyPayment(invoice(), 796_500)).toMatchObject({ status: "PAID", fullyPaid: true, remainingMinor: 0 });
    const part = applyPayment(invoice(), 300_000);
    expect(part).toMatchObject({ status: "OPEN", fullyPaid: false, amountPaidMinor: 300_000, remainingMinor: 496_500 });
    expect(applyPayment(invoice({ amountPaidMinor: 300_000 }), 496_500).status).toBe("PAID");
  });

  it.each([
    ["more than is owed", invoice({ amountPaidMinor: 700_000 }), 100_000, /more than what is still owed/],
    ["zero", invoice(), 0, /greater than zero/],
    ["a fraction of a paisa", invoice(), 10.5, /greater than zero/],
    ["a paid invoice", invoice({ status: "PAID", amountPaidMinor: 796_500 }), 1, /already paid/],
    ["a void invoice", invoice({ status: "VOID" }), 1, /voided/],
  ])("refuses paying %s", (_l, inv, amount, error) => {
    expect(() => applyPayment(inv, amount)).toThrow(error);
  });

  it("knows what is outstanding and overdue (gym-local dates)", () => {
    expect(outstanding(invoice({ amountPaidMinor: 100 }))).toBe(796_400);
    expect(isOverdue(invoice({ dueDate: "2026-10-01" }), TODAY)).toBe(true);
    expect(isOverdue(invoice({ dueDate: TODAY }), TODAY)).toBe(false);
    expect(isOverdue(invoice({ dueDate: "2026-10-01", status: "PAID", amountPaidMinor: 796_500 }), TODAY)).toBe(false);
  });

  it("only voids open invoices without payments", () => {
    expect(canVoid(invoice())).toBe(true);
    expect(canVoid(invoice({ amountPaidMinor: 1 }))).toBe(false);
    expect(canVoid(invoice({ status: "PAID" }))).toBe(false);
  });

  it("formats invoice numbers", () => {
    expect(formatInvoiceNumber(42)).toBe("INV-000042");
  });
});

describe("refunds", () => {
  const payment = { amountMinor: 100_000, status: "COMPLETED" };
  it("allows partial then full refunds up to the payment", () => {
    expect(validateRefund(payment, 0, 30_000)).toEqual({ fullyRefunded: false, status: "PARTIALLY_REFUNDED" });
    expect(validateRefund(payment, 30_000, 70_000)).toEqual({ fullyRefunded: true, status: "REFUNDED" });
    expect(refundable(payment, 30_000)).toBe(70_000);
  });
  it("refuses over-refunds and refunds of void or fully refunded payments", () => {
    expect(() => validateRefund(payment, 30_000, 70_001)).toThrow(BillingRuleError);
    expect(() => validateRefund(payment, 100_000, 1)).toThrow(/already been fully refunded/);
    expect(() => validateRefund({ ...payment, status: "VOID" }, 0, 1)).toThrow(BillingRuleError);
  });
});

describe("selling memberships", () => {
  it("renewals start the day after the current membership; otherwise today", () => {
    expect(renewalStartDate(TODAY, "2026-10-14")).toBe("2026-10-15");
    expect(renewalStartDate(TODAY, "2026-09-30")).toBe(TODAY);
    expect(renewalStartDate(TODAY, null)).toBe(TODAY);
  });

  it("prices from the plan with gym tax, inclusive end date and a due date", () => {
    expect(priceMembershipSale({ priceMinor: 675_000, durationDays: 90, classCredits: null }, 1800, "2026-10-15", TODAY)).toEqual({
      startDate: "2026-10-15",
      endDate: "2027-01-12",
      subtotalMinor: 675_000,
      taxMinor: 121_500,
      totalMinor: 796_500,
      dueDate: "2026-10-09",
      classCredits: null,
    });
  });

  it("validates the sale form (shared with the server)", () => {
    const base = { memberId: "m1", planId: "p1", startDate: TODAY, payNow: "full", amount: "", method: "CASH", reference: "" };
    expect(sellMembershipSchema.parse(base)).toMatchObject({ amountMinor: null, reference: null });
    expect(sellMembershipSchema.parse({ ...base, payNow: "partial", amount: "2,000" }).amountMinor).toBe(200_000);
    expect(sellMembershipSchema.safeParse({ ...base, payNow: "partial", amount: "" }).success).toBe(false);
    expect(sellMembershipSchema.safeParse({ ...base, method: "TRANSFER" }).success).toBe(false); // needs a reference
    expect(sellMembershipSchema.safeParse({ ...base, payNow: "none", method: "TRANSFER" }).success).toBe(true);
    expect(recordPaymentSchema.safeParse({ invoiceId: "i1", amount: "0", method: "CASH", reference: "" }).success).toBe(false);
  });
});

describe("check-in decisions", () => {
  const m = (over: Partial<MembershipRecord> = {}): MembershipRecord => ({ id: "m1", status: "ACTIVE", startDate: "2026-09-15", endDate: "2026-10-14", cancelledAt: null, freezes: [], ...over });

  it("allows an active membership", () => {
    expect(evaluateCheckIn([m()], TODAY)).toMatchObject({ result: "ALLOWED", membershipId: "m1" });
  });

  it("blocks expired members with the expiry date", () => {
    expect(evaluateCheckIn([m({ endDate: "2026-09-30" })], TODAY)).toEqual({ result: "DENIED_EXPIRED", membershipId: "m1", message: "Membership expired on 2026-09-30." });
  });

  it("blocks frozen, cancelled, not-yet-started and never-joined members", () => {
    expect(evaluateCheckIn([m({ freezes: [{ startDate: "2026-10-01", endDate: "2026-10-05" }] })], TODAY)).toMatchObject({ result: "DENIED_FROZEN", message: "Membership is frozen until 2026-10-05." });
    expect(evaluateCheckIn([m({ status: "CANCELLED" })], TODAY)).toMatchObject({ result: "DENIED_EXPIRED", message: "Membership was cancelled." });
    expect(evaluateCheckIn([m({ startDate: "2026-10-05", endDate: "2026-11-04" })], TODAY)).toMatchObject({ result: "DENIED_NO_MEMBERSHIP", message: "Membership starts on 2026-10-05." });
    expect(evaluateCheckIn([], TODAY)).toMatchObject({ result: "DENIED_NO_MEMBERSHIP", membershipId: null });
  });

  it("an expired old membership doesn't block a current one", () => {
    expect(evaluateCheckIn([m({ id: "old", endDate: "2026-08-01" }), m({ id: "new" })], TODAY)).toMatchObject({ result: "ALLOWED", membershipId: "new" });
  });

  it.each([
    ["FITCRM:ab3kq9zx2m", { kind: "code", code: "AB3KQ9ZX2M" }],
    ["AB3KQ9ZX2M", { kind: "code", code: "AB3KQ9ZX2M" }],
    ["M-000123", { kind: "memberNumber", value: 123 }],
    ["123", { kind: "memberNumber", value: 123 }],
    ["Ramakrishn", { kind: "name", text: "Ramakrishn" }], // 10 letters: a name, not a code
    ["Priya Nair", { kind: "name", text: "Priya Nair" }],
  ])("reads %j from the scanner / search box", (input, expected) => {
    expect(parseCheckInQuery(input)).toEqual(expected);
  });
});
