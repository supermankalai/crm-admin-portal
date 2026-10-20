import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, fromDateString, localDate, localDateTime } from "@/domain/dates";
import { appDb } from "@/server/db/client";
import { withTenant } from "@/server/db/context";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { generateGymNotifications } from "@/server/notifications";
import { refundPayment, voidInvoice } from "@/server/services/billing/payments";
import { assignTrainer } from "@/server/services/pt/assignments";
import { archivePackage, listPackages, memberPackages, savePackage, sellPackage, setCreditsRequired } from "@/server/services/pt/packages";
import { trainerReport } from "@/server/services/pt/report";
import { bookSession, closeSession } from "@/server/services/pt/sessions";
import { exportReport } from "@/server/services/reports";
import { resolveTenant } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { createTwoGyms, type World } from "../support/fixtures";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/** PT part 2: packages sold through invoices, session credits, the credit guard, alerts, the trainer report. */

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const TZ = "Asia/Kolkata";
const today = () => localDate(new Date(), TZ);
const on = (days: number, hhmm: string) => localDateTime(addDays(today(), days), hhmm, TZ);
const pay = { payNow: "full" as const, amount: "", amountMinor: null, method: "CASH" as const, reference: null };

let w: World;
let ownerA: TenantContext;
let deskA: TenantContext;
let trainer1: TenantContext;
let trainer2: TenantContext;
const ids = { trainer1: "", trainer2: "", trainer1User: "", memberUser: "", ten: "", two: "" };

async function sell(ctx: TenantContext, packageId: string, extra: Partial<Parameters<typeof sellPackage>[1]> = {}) {
  return sellPackage(ctx, { memberId: w.memberA.id, packageId, trainerId: null, startsOn: today(), ...pay, ...extra }, meta);
}
const book = (ctx: TenantContext, days: number, extra: Partial<Parameters<typeof bookSession>[1]> = {}) =>
  bookSession(ctx, { memberId: w.memberA.id, startsAt: on(days, "07:00"), durationMinutes: 60, focus: null, ...extra }, meta);

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const db = getOwnerDb();
  const test = await db.platformPlan.update({ where: { code: "TEST" }, data: { maxMembers: 100, maxStaff: 20 } });
  for (const g of [w.gymA, w.gymB]) {
    await db.gym.update({ where: { id: g.id }, data: { status: "ACTIVE", timezone: TZ, taxRateBps: 1800 } });
    await db.gymSubscription.create({ data: { gymId: g.id, planId: test.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
    await db.gymCounter.createMany({ data: [{ gymId: g.id, key: "member", value: 1 }, { gymId: g.id, key: "invoice", value: 0 }] });
  }
  const trainer = async (email: string) => {
    const u = await db.user.create({ data: { email, name: email.split("@")[0], passwordHash: "$argon2id$x" } });
    const s = await db.staffMember.create({ data: { gymId: w.gymA.id, userId: u.id, role: "TRAINER" } });
    return { u, staffId: s.id };
  };
  const t1 = await trainer("tara@pkg.test");
  const t2 = await trainer("tom@pkg.test");
  ids.trainer1 = t1.staffId;
  ids.trainer2 = t2.staffId;
  ids.trainer1User = t1.u.id;
  const memberUser = await db.user.create({ data: { email: "alice.pkg@pkg.test", name: "Alice", passwordHash: "$argon2id$x" } });
  ids.memberUser = memberUser.id;
  await db.memberAccount.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, userId: memberUser.id } });

  const u = (x: { id: string; name: string; email: string | null }) => ({ id: x.id, name: x.name, email: x.email ?? "", isSuperAdmin: false });
  ownerA = (await resolveTenant(u(w.users.ownerA), "gym-a"))!;
  deskA = (await resolveTenant(u(w.users.deskA), "gym-a"))!;
  trainer1 = (await resolveTenant(u(t1.u), "gym-a"))!;
  trainer2 = (await resolveTenant(u(t2.u), "gym-a"))!;
  await assignTrainer(ownerA, { memberId: w.memberA.id, trainerId: ids.trainer1, goal: null, targets: null }, meta);
  await assignTrainer(ownerA, { memberId: w.memberA.id, trainerId: ids.trainer2, goal: null, targets: null }, meta);
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("the package catalog", () => {
  it("is managed by owners and managers only", async () => {
    ids.ten = (await savePackage(ownerA, { name: "10 sessions", description: null, sessionCount: 10, price: 1_000_000, validityDays: 90, isActive: true }, meta)).id;
    ids.two = (await savePackage(ownerA, { name: "2 sessions", description: null, sessionCount: 2, price: 200_000, validityDays: 30, isActive: true }, meta)).id;
    await expect(savePackage(trainer1, { name: "Cheap", description: null, sessionCount: 1, price: 0, validityDays: 30, isActive: true }, meta)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(savePackage(deskA, { name: "Cheap", description: null, sessionCount: 1, price: 0, validityDays: 30, isActive: true }, meta)).rejects.toBeInstanceOf(ForbiddenError);
    // The database agrees: a trainer can't insert into the catalog directly.
    await expect(
      withTenant({ userId: ids.trainer1User, gymId: w.gymA.id }, (tx) => tx.ptPackage.create({ data: { gymId: w.gymA.id, name: "Free", sessionCount: 1, priceMinor: 0, validityDays: 30 }, select: { id: true } }))
    ).rejects.toThrow(/row-level security/);
    // The front desk sees it (to sell from).
    expect((await listPackages(deskA)).map((p) => p.name)).toEqual(["2 sessions", "10 sessions"]);
  });
});

describe("selling a package", () => {
  it("issues an invoice with tax and takes payment, in one go", async () => {
    const r = await sell(deskA, ids.ten);
    expect(r).toMatchObject({ totalMinor: 1_180_000, paidMinor: 1_180_000 });
    const db = getOwnerDb();
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: r.invoiceId }, include: { payments: true, ptPurchase: true } });
    expect(inv).toMatchObject({ status: "PAID", description: "PT package: 10 sessions (10 sessions)", subtotalMinor: 1_000_000, taxMinor: 180_000, amountPaidMinor: 1_180_000 });
    expect(inv.payments).toHaveLength(1);
    expect(inv.ptPurchase).toMatchObject({ sessionsTotal: 10, priceMinor: 1_000_000, soldById: w.staff.deskA.id });
    expect((await memberPackages(trainer1, w.memberA.id))[0]).toMatchObject({ name: "10 sessions", remaining: 10, state: "active" });
  });

  it("refuses trainers, archived packages and odd start dates", async () => {
    await expect(sell(trainer1, ids.ten)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sell(deskA, ids.ten, { startsOn: addDays(today(), 120) })).rejects.toBeInstanceOf(ValidationError);
    const old = await savePackage(ownerA, { name: "Old", description: null, sessionCount: 3, price: 100, validityDays: 30, isActive: true }, meta);
    await archivePackage(ownerA, old.id, meta);
    await expect(sell(deskA, old.id)).rejects.toThrow(/on sale/);
  });
});

describe("credits", () => {
  let sessionId = "";

  it("a booking uses a credit from the package that ends soonest", async () => {
    // A trainer-only 2-session package that ends sooner than the 10-session one.
    await sell(deskA, ids.two, { trainerId: ids.trainer1 });
    const r = await book(trainer1, 1);
    sessionId = r.id;
    expect(r.credit).toEqual({ packageName: "2 sessions", remainingAfter: 1 });
    // Tom can't use Tara's package: he gets the 10-session one.
    expect((await book(trainer2, 1, { startsAt: on(1, "09:00") })).credit).toEqual({ packageName: "10 sessions", remainingAfter: 9 });
  });

  it("a cancelled session gives its credit back; done and no-show keep it", async () => {
    await closeSession(trainer1, sessionId, "CANCELLED", meta);
    expect((await memberPackages(ownerA, w.memberA.id)).find((p) => p.name === "2 sessions")).toMatchObject({ used: 0, remaining: 2 });
    // A session that already happened, marked done: still holds its credit.
    const past = await getOwnerDb().trainingSession.create({
      data: { gymId: w.gymA.id, trainerId: ids.trainer1, memberId: w.memberA.id, startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() - 600_000), purchaseId: (await getOwnerDb().ptPackagePurchase.findFirstOrThrow({ where: { name: "2 sessions" } })).id },
    });
    await closeSession(trainer1, past.id, "COMPLETED", meta);
    expect((await memberPackages(ownerA, w.memberA.id)).find((p) => p.name === "2 sessions")).toMatchObject({ used: 1, remaining: 1 });
  });

  it("without credits: booked anyway, unless the gym requires them; managers may book complimentary", async () => {
    // Use up everything: 1 left on the 2-pack, 9 on the 10-pack (Tom's sessions).
    await book(trainer1, 2);
    expect((await book(trainer1, 3)).credit).toMatchObject({ packageName: "10 sessions" });
    await getOwnerDb().ptPackagePurchase.updateMany({ where: { name: "10 sessions" }, data: { cancelledAt: new Date(), cancelReason: "test: none left" } });
    expect(await book(trainer1, 4)).toMatchObject({ credit: null, complimentary: false });

    await setCreditsRequired(ownerA, true, meta);
    await expect(book(trainer1, 5)).rejects.toThrow(/no PT sessions left/);
    await expect(book(trainer1, 5, { complimentary: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await book(ownerA, 5, { trainerId: ids.trainer1, complimentary: true })).toMatchObject({ credit: null, complimentary: true });
    await expect(setCreditsRequired(deskA, false, meta)).rejects.toBeInstanceOf(ForbiddenError);
    await setCreditsRequired(ownerA, false, meta);
    await getOwnerDb().ptPackagePurchase.updateMany({ where: { name: "10 sessions" }, data: { cancelledAt: null, cancelReason: null } });
  });

  it("the database won't let a credit be spent twice or used for someone else", async () => {
    const two = await getOwnerDb().ptPackagePurchase.findFirstOrThrow({ where: { name: "2 sessions" } });
    const insert = (memberId: string, days: number) =>
      withTenant({ userId: ids.trainer1User, gymId: w.gymA.id }, (tx) =>
        tx.trainingSession.create({ data: { gymId: w.gymA.id, trainerId: ids.trainer1, memberId, startsAt: on(days, "20:00"), endsAt: on(days, "21:00"), purchaseId: two.id }, select: { id: true } })
      );
    await expect(insert(w.memberA.id, 6)).rejects.toThrow(/pt:no_credit/); // both credits are taken
    await getOwnerDb().trainerClient.create({ data: { gymId: w.gymA.id, trainerId: ids.trainer1, memberId: (await getOwnerDb().member.create({ data: { gymId: w.gymA.id, memberNumber: 9, firstName: "Ola", lastName: "Other", checkInCode: "OLAO000009" } })).id } });
    const ola = await getOwnerDb().member.findFirstOrThrow({ where: { firstName: "Ola" } });
    await expect(insert(ola.id, 6)).rejects.toThrow(/pt:credit_mismatch/);
  });
});

describe("cancelling a package with its invoice", () => {
  it("voiding an unpaid sale cancels the package; its booked sessions stay, uncovered", async () => {
    const r = await sell(deskA, ids.ten, { payNow: "none" });
    const s = await book(trainer2, 8, { startsAt: on(8, "18:00") });
    const db = getOwnerDb();
    // Make sure the session took this (soonest-ending, newest) package's credit.
    await db.trainingSession.update({ where: { id: s.id }, data: { purchaseId: (await db.ptPackagePurchase.findFirstOrThrow({ where: { invoiceId: r.invoiceId } })).id } });
    await voidInvoice(ownerA, r.invoiceId, "Sold by mistake", meta);
    const p = await db.ptPackagePurchase.findFirstOrThrow({ where: { invoiceId: r.invoiceId } });
    expect(p.cancelledAt).not.toBeNull();
    expect(p.cancelReason).toBe("Invoice voided: Sold by mistake");
    expect(await db.trainingSession.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: "SCHEDULED", purchaseId: null });
    await expect(bookSession(trainer2, { memberId: w.memberA.id, startsAt: on(9, "18:00"), durationMinutes: 60, focus: null }, meta)).resolves.toBeTruthy();
  });

  it("a refund cancels it when asked to", async () => {
    const r = await sell(deskA, ids.ten);
    const payment = await getOwnerDb().payment.findFirstOrThrow({ where: { invoiceId: r.invoiceId } });
    const out = await refundPayment(ownerA, { paymentId: payment.id, amount: 100_000, reason: "Moving away", cancelMembership: true }, meta);
    expect(out?.cancelledPtPackageId).toBe(r.purchaseId);
    expect((await memberPackages(ownerA, w.memberA.id)).find((p) => p.id === r.purchaseId)?.state).toBe("cancelled");
  });
});

describe("alerts", () => {
  it("reminds the member and the trainer before a session, and warns when credits run low", async () => {
    const db = getOwnerDb();
    await db.notification.deleteMany({});
    // A session in an hour, on the 2-pack (now with 0 credits left).
    await db.trainingSession.create({ data: { gymId: w.gymA.id, trainerId: ids.trainer1, memberId: w.memberA.id, startsAt: new Date(Date.now() + 3_600_000), endsAt: new Date(Date.now() + 7_200_000) } });
    await db.$transaction((tx) => generateGymNotifications(tx, w.gymA.id));
    const mine = await db.notification.findMany({ where: { recipientUserId: ids.memberUser }, select: { type: true, body: true } });
    expect(mine).toEqual(expect.arrayContaining([expect.objectContaining({ type: "PT_SESSION_REMINDER", body: expect.stringContaining("with tara") }), expect.objectContaining({ type: "PT_CREDITS_LOW", body: expect.stringContaining("no PT sessions left on 2 sessions") })]));
    const trainers = await db.notification.findMany({ where: { recipientUserId: ids.trainer1User }, select: { type: true } });
    expect(trainers.map((n) => n.type).sort()).toEqual(["PT_CREDITS_LOW", "PT_SESSION_REMINDER"]);
    // Once each.
    await db.$transaction((tx) => generateGymNotifications(tx, w.gymA.id));
    expect(await db.notification.count({ where: { recipientUserId: ids.memberUser } })).toBe(mine.length);
  });

  it("warns about sessions about to expire", async () => {
    const db = getOwnerDb();
    const p = await db.ptPackagePurchase.findFirstOrThrow({ where: { name: "10 sessions", cancelledAt: null }, orderBy: { createdAt: "asc" } });
    await db.ptPackagePurchase.update({ where: { id: p.id }, data: { expiresOn: fromDateString(addDays(today(), 3)) } });
    await db.$transaction((tx) => generateGymNotifications(tx, w.gymA.id));
    expect(await db.notification.count({ where: { recipientUserId: ids.memberUser, type: "PT_PACKAGE_EXPIRING" } })).toBe(1);
  });
});

describe("trainer report", () => {
  it("counts sessions and package sales per trainer, and exports them", async () => {
    const range = { from: addDays(today(), -1), to: today() };
    const r = await trainerReport(ownerA, range);
    const tara = r.rows.find((x) => x.name === "tara")!;
    expect(tara).toMatchObject({ clients: 2, completed: 1, packagesSold: 1, packageRevenueMinor: 236_000 });
    // Four sold: the voided one and the refunded-and-cancelled one don't count.
    expect(r.totals.packagesSold).toBe(2);
    const csv = (await exportReport(ownerA, "trainers", range, meta)).csv;
    expect(csv.split("\r\n")[0]).toContain("Sessions done");
    expect(csv).toContain("tara,Yes,2,");
    // PT sales show up in the revenue export with the package's name.
    expect((await exportReport(ownerA, "revenue", range, meta)).csv).toContain("PT: 10 sessions");
  });
});

describe("isolation", () => {
  it("another gym sees none of these sales", async () => {
    const rows = await withTenant({ userId: w.users.ownerB.id, gymId: w.gymB.id }, (tx) => tx.ptPackagePurchase.count());
    expect(rows).toBe(0);
  });
});

