import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, fromDateString, localDate } from "@/domain/dates";
import { appDb } from "@/server/db/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { recordPayment, refundPayment, voidInvoice } from "@/server/services/billing/payments";
import { listInvoices, listPayments } from "@/server/services/billing/queries";
import { sellMembership } from "@/server/services/billing/sell";
import { checkInMember, lookupForCheckIn, todaysCheckIns } from "@/server/services/checkin";
import { createMembershipPlan } from "@/server/services/membership-plans";
import { cancelMembership } from "@/server/services/members/memberships";
import { resolveTenant } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { createTwoGyms, type World } from "../support/fixtures";
import { asApp, disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const TZ = "Asia/Kolkata";
const today = () => localDate(new Date(), TZ);

let w: World;
let ownerA: TenantContext;
let deskA: TenantContext;
let ownerB: TenantContext;
let planId: string;
let locationA: string;
let locationB: string;

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const owner = getOwnerDb();
  const test = await owner.platformPlan.findFirstOrThrow({ where: { code: "TEST" } });
  for (const g of [w.gymA, w.gymB]) {
    await owner.gym.update({ where: { id: g.id }, data: { status: "ACTIVE", timezone: TZ, taxRateBps: 1800 } });
    await owner.gymSubscription.create({ data: { gymId: g.id, planId: test.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
    await owner.gymCounter.createMany({ data: [{ gymId: g.id, key: "member", value: 1 }, { gymId: g.id, key: "invoice", value: 0 }] });
  }
  locationA = (await owner.location.create({ data: { gymId: w.gymA.id, name: "Main" } })).id;
  locationB = (await owner.location.create({ data: { gymId: w.gymB.id, name: "Main" } })).id;
  const u = (x: { id: string; name: string; email: string }) => ({ ...x, isSuperAdmin: false });
  ownerA = (await resolveTenant(u(w.users.ownerA), "gym-a"))!;
  deskA = (await resolveTenant(u(w.users.deskA), "gym-a"))!;
  ownerB = (await resolveTenant(u(w.users.ownerB), "gym-b"))!;
  planId = (await createMembershipPlan(ownerA, { name: "Quarterly", description: null, type: "QUARTERLY", price: 675_000, durationDays: 90, classCredits: null, allowFreeze: true, maxFreezeDays: 14, cancellationNoticeDays: 0, cancellationFee: 50_000, isActive: true }, meta))!.id;
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

const sale = (over: Partial<Parameters<typeof sellMembership>[1]> = {}) => ({
  memberId: w.memberA.id,
  planId,
  startDate: today(),
  payNow: "none" as const,
  amount: "",
  amountMinor: null,
  method: "CASH" as const,
  reference: null,
  ...over,
});

describe("selling a membership", () => {
  it("creates membership, invoice and payment together, priced with gym tax", async () => {
    const r = await sellMembership(deskA, sale({ payNow: "full" }), meta);
    expect(r).toMatchObject({ invoiceNumber: 1, totalMinor: 796_500, paidMinor: 796_500, startDate: today(), endDate: addDays(today(), 89) });
    const owner = getOwnerDb();
    const inv = await owner.invoice.findUniqueOrThrow({ where: { id: r.invoiceId }, include: { payments: true } });
    expect(inv).toMatchObject({ status: "PAID", subtotalMinor: 675_000, taxMinor: 121_500, amountPaidMinor: 796_500, description: "Quarterly membership" });
    expect(inv.payments).toHaveLength(1);
    expect(await owner.membership.count({ where: { id: r.membershipId, status: "ACTIVE" } })).toBe(1);
    expect(await owner.auditLog.count({ where: { gymId: w.gymA.id, action: { in: ["membership.sell", "payment.record"] } } })).toBe(2);
  });

  it("refuses overlapping memberships and suggests the renewal date", async () => {
    await expect(sellMembership(deskA, sale(), meta)).rejects.toMatchObject({ message: expect.stringMatching(`Start it on ${addDays(today(), 90)}`) });
    const renewal = await sellMembership(deskA, sale({ startDate: addDays(today(), 90) }), meta);
    expect(renewal.invoiceNumber).toBe(2);
  });

  it("is atomic: nothing is written if the payment step fails", async () => {
    const owner = getOwnerDb();
    const before = { m: await owner.membership.count(), i: await owner.invoice.count() };
    const other = await owner.member.create({ data: { gymId: w.gymA.id, memberNumber: 50, firstName: "Atomic", lastName: "Test", checkInCode: "ATOMIC0001" } });
    await expect(sellMembership(deskA, sale({ memberId: other.id, payNow: "partial", amountMinor: 999_999_999 }), meta)).rejects.toThrow(/more than what is still owed/);
    expect({ m: await owner.membership.count(), i: await owner.invoice.count() }).toEqual(before);
  });

  it("cannot sell to another gym's member or with another gym's plan", async () => {
    await expect(sellMembership(ownerB, sale(), meta)).rejects.toThrow(NotFoundError);
  });
});

describe("recording payments", () => {
  let invoiceId: string;
  beforeAll(async () => {
    const other = await getOwnerDb().member.create({ data: { gymId: w.gymA.id, memberNumber: 60, firstName: "Part", lastName: "Payer", checkInCode: "PARTPAY001" } });
    invoiceId = (await sellMembership(deskA, sale({ memberId: other.id, payNow: "partial", amountMinor: 300_000 }), meta)).invoiceId;
  });

  it("supports part payments until the invoice is paid", async () => {
    const r = await recordPayment(deskA, { invoiceId, amount: 196_500, method: "CARD", reference: "POS-1" }, meta);
    expect(r).toMatchObject({ fullyPaid: false, remainingMinor: 300_000 });
    await expect(recordPayment(deskA, { invoiceId, amount: 300_001, method: "CASH", reference: null }, meta)).rejects.toThrow(/more than what is still owed/);
  });

  it("concurrent payments can never overpay an invoice (row lock)", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => recordPayment(deskA, { invoiceId, amount: 300_000, method: "CASH", reference: null }, meta)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const inv = await getOwnerDb().invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv).toMatchObject({ status: "PAID", amountPaidMinor: inv.totalMinor });
  });

  it("other gyms and trainers cannot record payments on it", async () => {
    await expect(recordPayment(ownerB, { invoiceId, amount: 1, method: "CASH", reference: null }, meta)).rejects.toThrow(NotFoundError);
  });
});

describe("refunds", () => {
  let paymentId: string;
  let membershipId: string;
  beforeAll(async () => {
    const other = await getOwnerDb().member.create({ data: { gymId: w.gymA.id, memberNumber: 70, firstName: "Re", lastName: "Fund", checkInCode: "REFUND0001" } });
    const sold = await sellMembership(deskA, sale({ memberId: other.id, payNow: "full" }), meta);
    membershipId = sold.membershipId;
    paymentId = (await getOwnerDb().payment.findFirstOrThrow({ where: { invoiceId: sold.invoiceId } })).id;
  });

  it("front desk cannot refund", async () => {
    await expect(refundPayment(deskA, { paymentId, amount: 1, reason: "test", cancelMembership: false }, meta)).rejects.toThrow(ForbiddenError);
  });

  it("partial then full refund updates the payment status; over-refunds are refused", async () => {
    expect(await refundPayment(ownerA, { paymentId, amount: 96_500, reason: "Goodwill", cancelMembership: false }, meta)).toMatchObject({ status: "PARTIALLY_REFUNDED" });
    await expect(refundPayment(ownerA, { paymentId, amount: 700_001, reason: "Too much", cancelMembership: false }, meta)).rejects.toThrow(ValidationError);
    const full = await refundPayment(ownerA, { paymentId, amount: 700_000, reason: "Moving away", cancelMembership: true }, meta);
    expect(full).toMatchObject({ status: "REFUNDED", cancelledMembershipId: membershipId });
    const owner = getOwnerDb();
    expect((await owner.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("REFUNDED");
    expect((await owner.membership.findUniqueOrThrow({ where: { id: membershipId } })).status).toBe("CANCELLED");
  });

  it("the database refuses over-refunds even when the app check is bypassed, and refunds are immutable", async () => {
    const owner = getOwnerDb();
    await expect(owner.refund.create({ data: { gymId: w.gymA.id, paymentId, amountMinor: 1, reason: "bypass", refundedAt: new Date(), recordedById: ownerA.staffId! } })).rejects.toThrow(/refund:exceeds_payment/);
    const refund = await owner.refund.findFirstOrThrow({ where: { paymentId } });
    await expect(asApp({ userId: w.users.ownerA.id, gymId: w.gymA.id }, (tx) => tx.refund.updateMany({ where: { id: refund.id }, data: { amountMinor: 1 } }))).rejects.toThrow(/permission denied/i);
  });

  it("concurrent refunds never exceed the payment", async () => {
    const other = await getOwnerDb().member.create({ data: { gymId: w.gymA.id, memberNumber: 71, firstName: "Race", lastName: "Refund", checkInCode: "RACEREF001" } });
    const sold = await sellMembership(deskA, sale({ memberId: other.id, payNow: "full" }), meta);
    const pid = (await getOwnerDb().payment.findFirstOrThrow({ where: { invoiceId: sold.invoiceId } })).id;
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => refundPayment(ownerA, { paymentId: pid, amount: 400_000, reason: "race", cancelMembership: false }, meta)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const total = await getOwnerDb().refund.aggregate({ where: { paymentId: pid }, _sum: { amountMinor: true } });
    expect(total._sum.amountMinor).toBe(400_000);
  });
});

describe("voiding and cancellation fees", () => {
  it("voids an unpaid sale and cancels its membership; paid invoices can't be voided", async () => {
    const other = await getOwnerDb().member.create({ data: { gymId: w.gymA.id, memberNumber: 80, firstName: "Mis", lastName: "Take", checkInCode: "MISTAKE001" } });
    const sold = await sellMembership(deskA, sale({ memberId: other.id }), meta);
    await voidInvoice(ownerA, sold.invoiceId, "Sold to the wrong member", meta);
    const owner = getOwnerDb();
    expect((await owner.invoice.findUniqueOrThrow({ where: { id: sold.invoiceId } })).status).toBe("VOID");
    expect((await owner.membership.findUniqueOrThrow({ where: { id: sold.membershipId } })).status).toBe("CANCELLED");
    const paid = await owner.invoice.findFirstOrThrow({ where: { gymId: w.gymA.id, status: "PAID" } });
    await expect(voidInvoice(ownerA, paid.id, "nope", meta)).rejects.toThrow(/refund the payment instead/);
  });

  it("cancelling a membership with a fee raises a cancellation-fee invoice in the same transaction", async () => {
    const other = await getOwnerDb().member.create({ data: { gymId: w.gymA.id, memberNumber: 81, firstName: "Fee", lastName: "Payer", checkInCode: "FEEPAYER01" } });
    const sold = await sellMembership(deskA, sale({ memberId: other.id, payNow: "full" }), meta);
    const result = await cancelMembership(ownerA, sold.membershipId, "Leaving", meta);
    expect(result.feeInvoiceNumber).not.toBeNull();
    const fee = await getOwnerDb().invoice.findFirstOrThrow({ where: { number: result.feeInvoiceNumber!, gymId: w.gymA.id } });
    expect(fee).toMatchObject({ description: "Cancellation fee — Quarterly", subtotalMinor: 50_000, taxMinor: 9_000, totalMinor: 59_000, status: "OPEN" });
  });
});

describe("lists", () => {
  it("payment totals and overdue invoices are per gym", async () => {
    const owner = getOwnerDb();
    const member = await owner.member.create({ data: { gymId: w.gymA.id, memberNumber: 90, firstName: "Over", lastName: "Due", checkInCode: "OVERDUE001" } });
    await owner.invoice.create({ data: { gymId: w.gymA.id, number: 999, memberId: member.id, currency: "INR", subtotalMinor: 100, taxMinor: 0, totalMinor: 100, issuedAt: new Date(), dueDate: fromDateString(addDays(today(), -3)) } });
    const overdue = await listInvoices(ownerA, { status: "overdue" });
    expect(overdue.rows.map((r) => r.number)).toContain(999);
    expect(overdue.rows.every((r) => r.overdue)).toBe(true);
    expect((await listInvoices(ownerB, { status: "overdue" })).total).toBe(0);
    const payments = await listPayments(ownerA, {});
    expect(payments.totals.grossMinor).toBeGreaterThan(0);
    expect(payments.totals.netMinor).toBe(payments.totals.grossMinor - payments.totals.refundsMinor);
    expect((await listPayments(ownerB, {})).total).toBe(0);
  });
});

describe("check-in", () => {
  it("allows a member with an active membership, by QR code, and records it", async () => {
    const code = (await getOwnerDb().member.findUniqueOrThrow({ where: { id: w.memberA.id } })).checkInCode;
    const found = await lookupForCheckIn(deskA, `FITCRM:${code}`);
    expect(found.method).toBe("QR");
    expect(found.candidates).toHaveLength(1);
    expect(found.candidates[0].decision.result).toBe("ALLOWED");
    const r = await checkInMember(deskA, { memberId: w.memberA.id, locationId: locationA, method: "QR" }, meta);
    expect(r).toMatchObject({ result: "ALLOWED", duplicate: false });
    expect(await getOwnerDb().checkIn.count({ where: { id: r.checkInId, result: "ALLOWED", method: "QR" } })).toBe(1);
  });

  it("a second scan within two minutes is not counted twice — even when concurrent", async () => {
    const results = await Promise.all(Array.from({ length: 3 }, () => checkInMember(deskA, { memberId: w.memberA.id, locationId: locationA, method: "QR" }, meta)));
    expect(results.every((r) => r.duplicate)).toBe(true);
    expect((await todaysCheckIns(deskA)).allowed).toBe(1);
  });

  it("blocks and records an expired member", async () => {
    const owner = getOwnerDb();
    const expired = await owner.member.create({ data: { gymId: w.gymA.id, memberNumber: 100, firstName: "Ex", lastName: "Pired", checkInCode: "EXPIRED001" } });
    await owner.membership.create({ data: { id: createId(), gymId: w.gymA.id, memberId: expired.id, planId, startDate: fromDateString(addDays(today(), -100)), endDate: fromDateString(addDays(today(), -10)), priceMinor: 1 } });
    const r = await checkInMember(deskA, { memberId: expired.id, locationId: locationA, method: "MEMBER_ID" }, meta);
    expect(r).toMatchObject({ result: "DENIED_EXPIRED", message: `Membership expired on ${addDays(today(), -10)}.` });
    expect(await owner.checkIn.count({ where: { memberId: expired.id, result: "DENIED_EXPIRED" } })).toBe(1);
    // Denied attempts are never treated as duplicates — each one is recorded.
    await checkInMember(deskA, { memberId: expired.id, locationId: locationA, method: "MEMBER_ID" }, meta);
    expect(await owner.checkIn.count({ where: { memberId: expired.id } })).toBe(2);
  });

  it("finds members by member number and name, never across gyms", async () => {
    expect((await lookupForCheckIn(deskA, "M-000100")).candidates.map((c) => c.name)).toEqual(["Ex Pired"]);
    expect((await lookupForCheckIn(deskA, "alice")).candidates.map((c) => c.name)).toEqual(["Alice Anand"]);
    expect((await lookupForCheckIn(ownerB, "alice")).candidates).toHaveLength(0);
    const code = (await getOwnerDb().member.findUniqueOrThrow({ where: { id: w.memberA.id } })).checkInCode;
    expect((await lookupForCheckIn(ownerB, code)).candidates).toHaveLength(0);
  });

  it("another gym cannot check in this gym's member or use its location", async () => {
    await expect(checkInMember(ownerB, { memberId: w.memberA.id, locationId: locationB, method: "QR" }, meta)).rejects.toThrow(NotFoundError);
    await expect(checkInMember(deskA, { memberId: w.memberA.id, locationId: locationB, method: "QR" }, meta)).rejects.toThrow(/valid location/);
  });

  it("check-ins are immutable for the app role", async () => {
    await expect(asApp({ userId: w.users.ownerA.id, gymId: w.gymA.id }, (tx) => tx.checkIn.deleteMany({}))).rejects.toThrow(/permission denied/i);
  });
});
