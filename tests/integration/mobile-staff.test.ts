import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as loginRoute from "@/app/api/mobile/v1/auth/login/route";
import * as selectGymRoute from "@/app/api/mobile/v1/auth/select-gym/route";
import * as alertsRoute from "@/app/api/mobile/v1/staff/alerts/route";
import * as lookupRoute from "@/app/api/mobile/v1/staff/check-in/lookup/route";
import * as checkInRoute from "@/app/api/mobile/v1/staff/check-in/route";
import * as classRoute from "@/app/api/mobile/v1/staff/classes/[sessionId]/route";
import * as classesRoute from "@/app/api/mobile/v1/staff/classes/route";
import * as dashboardRoute from "@/app/api/mobile/v1/staff/dashboard/route";
import * as memberRoute from "@/app/api/mobile/v1/staff/members/[memberId]/route";
import * as membersRoute from "@/app/api/mobile/v1/staff/members/route";
import * as sellRoute from "@/app/api/mobile/v1/staff/memberships/sell/route";
import * as paymentsRoute from "@/app/api/mobile/v1/staff/payments/route";
import * as plansRoute from "@/app/api/mobile/v1/staff/plans/route";
import { addDays, fromDateString, localDate } from "@/domain/dates";
import { hashPassword } from "@/server/auth/password";
import { appDb } from "@/server/db/client";
import { mintMemberQr } from "@/server/mobile/qr";
import { createTwoGyms, type World } from "../support/fixtures";
import { callApi, device } from "../support/mobile-api";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/** Mobile Phase 4: front desk and owner/manager features over the staff API. */

const TZ = "Asia/Kolkata";
const PASSWORD = "Staff-Pass-2026";
let w: World;
let planId: string;
let locationId: string;
let overdueInvoiceId: string;
let fullSessionId: string;
let trainerSessionId: string;
const tokens: Record<"owner" | "desk" | "trainer" | "ownerB", string> = { owner: "", desk: "", trainer: "", ownerB: "" };

const today = () => localDate(new Date(), TZ);
const newMember = (firstName: string, lastName: string) => ({ firstName, lastName, dateOfBirth: "", healthNotes: "", email: "", phone: "", address: "", emergencyContact: { name: "", phone: "", relation: "" } });

async function staffToken(email: string, slug: string) {
  const login = await callApi<{ accessToken: string }>(loginRoute.POST, { body: { identifier: email, password: PASSWORD, device: device() } });
  const scoped = await callApi<{ accessToken: string }>(selectGymRoute.POST, { token: login.body.accessToken, body: { gymSlug: slug } });
  if (scoped.status !== 200) throw new Error(`select-gym ${scoped.status}`);
  return scoped.body.accessToken;
}

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const db = getOwnerDb();
  await db.user.updateMany({ data: { passwordHash: await hashPassword(PASSWORD) } });
  const plan = await db.platformPlan.update({ where: { code: "TEST" }, data: { maxMembers: 100 } });
  for (const g of [w.gymA, w.gymB]) {
    await db.gym.update({ where: { id: g.id }, data: { status: "ACTIVE", timezone: TZ, currency: "INR" } });
    await db.gymCounter.createMany({ data: [{ gymId: g.id, key: "member", value: 100 }, { gymId: g.id, key: "invoice", value: 10 }] });
    await db.gymSubscription.create({ data: { gymId: g.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  }
  // A trainer in gym A.
  const trainerUser = await db.user.create({ data: { email: "trainer.a@test.example", name: "Trainer A", passwordHash: await hashPassword(PASSWORD) } });
  const trainer = await db.staffMember.create({ data: { gymId: w.gymA.id, userId: trainerUser.id, role: "TRAINER" } });

  planId = (await db.membershipPlan.create({ data: { gymId: w.gymA.id, name: "Monthly", type: "MONTHLY", priceMinor: 150000, durationDays: 30 } })).id;
  await db.membershipPlan.create({ data: { gymId: w.gymA.id, name: "Retired", type: "MONTHLY", priceMinor: 1, durationDays: 30, isActive: false } });
  locationId = (await db.location.create({ data: { gymId: w.gymA.id, name: "Main" } })).id;
  await db.location.create({ data: { gymId: w.gymB.id, name: "Main B" } });
  const room = await db.room.create({ data: { gymId: w.gymA.id, locationId, name: "Studio", capacity: 30 } });
  const type = await db.classType.create({ data: { gymId: w.gymA.id, name: "Yoga", color: "#22c55e", durationMinutes: 60, defaultCapacity: 10 } });

  // Alice (fixture member of gym A): active membership expiring in 5 days, plus an overdue invoice.
  await db.membership.create({ data: { id: createId(), gymId: w.gymA.id, memberId: w.memberA.id, planId, startDate: fromDateString(addDays(today(), -25)), endDate: fromDateString(addDays(today(), 5)), priceMinor: 150000 } });
  overdueInvoiceId = (
    await db.invoice.create({ data: { gymId: w.gymA.id, number: 1, memberId: w.memberA.id, currency: "INR", subtotalMinor: 100000, taxMinor: 0, totalMinor: 100000, amountPaidMinor: 40000, status: "OPEN", issuedAt: new Date(Date.now() - 20 * 86_400_000), dueDate: fromDateString(addDays(today(), -3)) } })
  ).id;

  // A full class tomorrow (capacity 1, booked by Alice) taught by the owner, and one taught by the trainer.
  const at = (h: number) => new Date(Date.now() + h * 3_600_000);
  fullSessionId = (await db.classSession.create({ data: { gymId: w.gymA.id, classTypeId: type.id, trainerId: w.staff.ownerA.id, roomId: room.id, startsAt: at(24), endsAt: at(25), capacity: 1 } })).id;
  await db.booking.create({ data: { gymId: w.gymA.id, sessionId: fullSessionId, memberId: w.memberA.id, status: "BOOKED" } });
  trainerSessionId = (await db.classSession.create({ data: { gymId: w.gymA.id, classTypeId: type.id, trainerId: trainer.id, roomId: room.id, startsAt: at(26), endsAt: at(27), capacity: 10 } })).id;

  tokens.owner = await staffToken(w.users.ownerA.email, "gym-a");
  tokens.desk = await staffToken(w.users.deskA.email, "gym-a");
  tokens.trainer = await staffToken("trainer.a@test.example", "gym-a");
  tokens.ownerB = await staffToken(w.users.ownerB.email, "gym-b");
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("QR check-in", () => {
  it("scans a member's rotating app code, checks them in, and refuses the same code twice", async () => {
    const { token } = mintMemberQr(w.gymA.id, w.memberA.id);
    const found = await callApi<{ method: string; candidates: { id: string; name: string; decision: { result: string }; overdueInvoices: number }[] }>(lookupRoute.POST, { token: tokens.desk, body: { query: token } });
    expect(found.status).toBe(200);
    expect(found.body.method).toBe("QR");
    expect(found.body.candidates).toEqual([expect.objectContaining({ id: w.memberA.id, name: "Alice Anand", decision: expect.objectContaining({ result: "ALLOWED" }), overdueInvoices: 1 })]);

    const checked = await callApi<{ result: string; name: string; duplicate: boolean }>(checkInRoute.POST, { token: tokens.desk, body: { memberId: w.memberA.id, locationId, method: "QR" } });
    expect(checked.status).toBe(201);
    expect(checked.body).toMatchObject({ result: "ALLOWED", name: "Alice Anand", duplicate: false });

    const again = await callApi(lookupRoute.POST, { token: tokens.desk, body: { query: token } });
    expect(again.status).toBe(422);
    expect(again.body.error?.message).toMatch(/already been used|used/i);
  });

  it("does not find another gym's member from a code signed for that gym", async () => {
    const { token } = mintMemberQr(w.gymB.id, w.memberB.id);
    const r = await callApi(lookupRoute.POST, { token: tokens.desk, body: { query: token } });
    expect(r.status).toBe(422);
    const forced = await callApi(checkInRoute.POST, { token: tokens.desk, body: { memberId: w.memberB.id, locationId, method: "QR" } });
    expect(forced.status).toBe(404);
  });

  it("records a denied attempt for a member without a membership, with the reason", async () => {
    const db = getOwnerDb();
    const m = await db.member.create({ data: { gymId: w.gymA.id, memberNumber: 50, firstName: "Nora", lastName: "None", checkInCode: "NONE000050" } });
    const r = await callApi<{ result: string; message: string }>(checkInRoute.POST, { token: tokens.owner, body: { memberId: m.id, locationId, method: "MEMBER_ID" } });
    expect(r.status).toBe(201);
    expect(r.body.result).not.toBe("ALLOWED");
    expect(r.body.message.length).toBeGreaterThan(0);
  });
});

describe("dashboard and alerts", () => {
  it("shows money to the owner but not to the front desk", async () => {
    const owner = await callApi<{ revenue: unknown; overdue: { count: number; totalMinor: number } | null; expiring: { memberId: string }[]; checkInsToday: number }>(dashboardRoute.GET, { token: tokens.owner });
    expect(owner.status).toBe(200);
    expect(owner.body.revenue).toEqual({ todayMinor: expect.any(Number), monthMinor: expect.any(Number) });
    expect(owner.body.overdue).toEqual({ count: 1, totalMinor: 60000 });
    expect(owner.body.expiring.map((e) => e.memberId)).toContain(w.memberA.id);
    expect(owner.body.checkInsToday).toBeGreaterThanOrEqual(1);

    const desk = await callApi<{ revenue: unknown }>(dashboardRoute.GET, { token: tokens.desk });
    expect(desk.body.revenue).toBeNull();

    const trainer = await callApi<{ revenue: unknown; overdue: unknown }>(dashboardRoute.GET, { token: tokens.trainer });
    expect(trainer.body).toMatchObject({ revenue: null, overdue: null });
  });

  it("lists expiring memberships, overdue invoices and full classes", async () => {
    const r = await callApi<{ expiring: { memberId: string }[]; overdue: { invoiceId: string; outstandingMinor: number }[] | null; fullClasses: { sessionId: string }[] }>(alertsRoute.GET, { token: tokens.owner });
    expect(r.status).toBe(200);
    expect(r.body.expiring.map((e) => e.memberId)).toContain(w.memberA.id);
    expect(r.body.overdue).toEqual([expect.objectContaining({ invoiceId: overdueInvoiceId, outstandingMinor: 60000 })]);
    expect(r.body.fullClasses.map((c) => c.sessionId)).toEqual([fullSessionId]);

    const trainer = await callApi<{ overdue: unknown }>(alertsRoute.GET, { token: tokens.trainer });
    expect(trainer.body.overdue).toBeNull();
  });

  it("never shows another gym's data", async () => {
    const r = await callApi<{ expiring: unknown[]; overdue: unknown[]; fullClasses: unknown[] }>(alertsRoute.GET, { token: tokens.ownerB });
    expect(r.body).toMatchObject({ expiring: [], overdue: [], fullClasses: [] });
  });
});

describe("members", () => {
  it("searches and pages members of the current gym only", async () => {
    const r = await callApi<{ total: number; items: { id: string; name: string }[]; nextCursor: string | null }>(membersRoute.GET, { token: tokens.desk, query: { q: "ali" } });
    expect(r.status).toBe(200);
    expect(r.body.items.map((m) => m.id)).toEqual([w.memberA.id]);
    expect(r.body.nextCursor).toBeNull();
    const bob = await callApi<{ items: unknown[] }>(membersRoute.GET, { token: tokens.desk, query: { q: "Bob" } });
    expect(bob.body.items).toEqual([]);
  });

  it("shows a profile with payments to the front desk, and 404s across gyms", async () => {
    const r = await callApi<{ member: { name: string }; status: string; openInvoices: { id: string; overdue: boolean }[] | null; can: { recordPayment: boolean } }>(memberRoute.GET, { token: tokens.desk, params: { memberId: w.memberA.id } });
    expect(r.status).toBe(200);
    expect(r.body.member.name).toBe("Alice Anand");
    expect(r.body.status).toBe("active");
    expect(r.body.openInvoices).toEqual([expect.objectContaining({ id: overdueInvoiceId, overdue: true })]);
    expect(r.body.can.recordPayment).toBe(true);
    const cross = await callApi(memberRoute.GET, { token: tokens.desk, params: { memberId: w.memberB.id } });
    expect(cross.status).toBe(404);
  });

  it("adds a member with the web's validation, and refuses trainers", async () => {
    const bad = await callApi<{ error: { code: string; fieldErrors?: Record<string, string[]> } }>(membersRoute.POST, { token: tokens.desk, body: newMember("", "X") });
    expect(bad.status).toBe(422);
    const ok = await callApi<{ memberId: string; memberNumber: string }>(membersRoute.POST, { token: tokens.desk, body: newMember("Quinn", "Quick") });
    expect(ok.status).toBe(201);
    expect(ok.body.memberNumber).toMatch(/\d/);
    const audit = await getOwnerDb().auditLog.findFirst({ where: { gymId: w.gymA.id, action: "member.create", entityId: ok.body.memberId } });
    expect(audit).not.toBeNull();
    const trainer = await callApi(membersRoute.POST, { token: tokens.trainer, body: newMember("No", "Way") });
    expect(trainer.status).toBe(403);
  });
});

describe("sell and record payments", () => {
  it("lists only active plans", async () => {
    const r = await callApi<{ plans: { name: string }[] }>(plansRoute.GET, { token: tokens.desk });
    expect(r.body.plans.map((p) => p.name)).toEqual(["Monthly"]);
  });

  it("records a payment against an overdue invoice", async () => {
    const r = await callApi<{ invoiceStatus: string; amountPaidMinor: number }>(paymentsRoute.POST, { token: tokens.desk, body: { invoiceId: overdueInvoiceId, amount: "600", method: "CASH", reference: "" } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ invoiceStatus: "PAID", amountPaidMinor: 100000 });
    const trainer = await callApi(paymentsRoute.POST, { token: tokens.trainer, body: { invoiceId: overdueInvoiceId, amount: "1", method: "CASH", reference: "" } });
    expect(trainer.status).toBe(403);
  });

  it("sells a membership with payment", async () => {
    const db = getOwnerDb();
    const m = await db.member.create({ data: { gymId: w.gymA.id, memberNumber: 60, firstName: "Sam", lastName: "Sale", checkInCode: "SALE000060" } });
    const r = await callApi<{ invoiceNumber: string; totalMinor: number; paidMinor: number }>(sellRoute.POST, {
      token: tokens.desk,
      body: { memberId: m.id, planId, startDate: today(), payNow: "full", amount: "", method: "CARD", reference: "" },
    });
    expect(r.status).toBe(201);
    expect(r.body.paidMinor).toBe(r.body.totalMinor);
  });

  it("blocks every write while the gym is read-only, but still allows reads", async () => {
    const db = getOwnerDb();
    await db.gymSubscription.updateMany({ where: { gymId: w.gymA.id }, data: { status: "EXPIRED" } });
    try {
      const token = await staffToken(w.users.deskA.email, "gym-a");
      const read = await callApi(membersRoute.GET, { token });
      expect(read.status).toBe(200);
      const writes = await Promise.all([
        callApi(checkInRoute.POST, { token, body: { memberId: w.memberA.id, locationId, method: "MEMBER_ID" } }),
        callApi(membersRoute.POST, { token, body: newMember("Read", "Only") }),
        callApi(paymentsRoute.POST, { token, body: { invoiceId: overdueInvoiceId, amount: "1", method: "CASH", reference: "" } }),
      ]);
      expect(writes.map((x) => [x.status, x.body.error?.code])).toEqual(Array(3).fill([409, "read_only"]));
    } finally {
      await db.gymSubscription.updateMany({ where: { gymId: w.gymA.id }, data: { status: "ACTIVE" } });
    }
  });
});

describe("classes", () => {
  it("shows the week with booking numbers, and a class with its bookings", async () => {
    const r = await callApi<{ classes: { id: string; booked: number; capacity: number }[] }>(classesRoute.GET, { token: tokens.desk });
    expect(r.status).toBe(200);
    expect(r.body.classes.find((c) => c.id === fullSessionId)).toMatchObject({ booked: 1, capacity: 1 });
    const one = await callApi<{ bookings: { memberId: string; status: string }[] }>(classRoute.GET, { token: tokens.desk, params: { sessionId: fullSessionId } });
    expect(one.body.bookings).toEqual([expect.objectContaining({ memberId: w.memberA.id, status: "BOOKED" })]);
  });

  it("shows trainers only their own classes", async () => {
    const r = await callApi<{ classes: { id: string }[] }>(classesRoute.GET, { token: tokens.trainer });
    expect(r.body.classes.map((c) => c.id)).toEqual([trainerSessionId]);
  });

  it("404s on another gym's class", async () => {
    const r = await callApi(classRoute.GET, { token: tokens.ownerB, params: { sessionId: fullSessionId } });
    expect(r.status).toBe(404);
  });
});
