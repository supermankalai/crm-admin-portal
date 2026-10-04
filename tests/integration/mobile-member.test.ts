import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as loginRoute from "@/app/api/mobile/v1/auth/login/route";
import * as selectGymRoute from "@/app/api/mobile/v1/auth/select-gym/route";
import * as attendanceRoute from "@/app/api/mobile/v1/member/attendance/route";
import * as cancelRoute from "@/app/api/mobile/v1/member/bookings/[bookingId]/route";
import * as cardRoute from "@/app/api/mobile/v1/member/card/route";
import * as bookRoute from "@/app/api/mobile/v1/member/classes/[sessionId]/book/route";
import * as classesRoute from "@/app/api/mobile/v1/member/classes/route";
import * as invoiceRoute from "@/app/api/mobile/v1/member/invoices/[invoiceId]/route";
import * as invoicesRoute from "@/app/api/mobile/v1/member/invoices/route";
import * as membershipRoute from "@/app/api/mobile/v1/member/membership/route";
import * as paymentsRoute from "@/app/api/mobile/v1/member/payments/route";
import { addDays, fromDateString, localDate } from "@/domain/dates";
import { hashPassword } from "@/server/auth/password";
import { appDb } from "@/server/db/client";
import { withMemberAction } from "@/server/db/context";
import { mintMemberQr } from "@/server/mobile/qr";
import { checkInMember, lookupForCheckIn } from "@/server/services/checkin";
import { resolveTenant } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { createTwoGyms, type World } from "../support/fixtures";
import { callApi, device } from "../support/mobile-api";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/** Mobile Phase 3: member card QR, membership, class booking, attendance and payment history. */

const TZ = "Asia/Kolkata";
const PASSWORD = "Member-Pass-2026";
const meta = { ip: "127.0.0.1", userAgent: "vitest" };
let w: World;
let planId: string;
let packPlanId: string;
let deskA: TenantContext;
let deskB: TenantContext;
const sessions: Record<string, string> = {};
const members: Record<string, { memberId: string; email: string }> = {};
let aliceInvoiceId: string;
let beaInvoiceId: string;

const today = () => localDate(new Date(), TZ);

async function memberWithAccount(key: string, gymId: string, n: number, plan: "monthly" | "pack" | "none" = "monthly", credits = 2) {
  const db = getOwnerDb();
  const email = `${key}@member.test`;
  const m = await db.member.create({ data: { gymId, memberNumber: 100 + n, firstName: key[0].toUpperCase() + key.slice(1), lastName: "Test", email, checkInCode: `MEMB${String(n).padStart(6, "0")}` } });
  const u = await db.user.create({ data: { email, name: `${key} test`, passwordHash: await hashPassword(PASSWORD) } });
  await db.memberAccount.create({ data: { gymId, memberId: m.id, userId: u.id } });
  if (plan !== "none") {
    await db.membership.create({
      data: {
        id: createId(),
        gymId,
        memberId: m.id,
        planId: plan === "pack" ? packPlanId : planId,
        startDate: fromDateString(addDays(today(), -10)),
        endDate: fromDateString(addDays(today(), 40)),
        priceMinor: 100,
        classCreditsRemaining: plan === "pack" ? credits : null,
      },
    });
  }
  members[key] = { memberId: m.id, email };
  return m.id;
}

async function memberToken(key: string, slug = "gym-a") {
  const login = await callApi<{ accessToken: string }>(loginRoute.POST, { body: { identifier: members[key].email, password: PASSWORD, device: device() } });
  const scoped = await callApi<{ accessToken: string }>(selectGymRoute.POST, { token: login.body.accessToken, body: { gymSlug: slug } });
  if (scoped.status !== 200) throw new Error(`select-gym ${scoped.status}`);
  return scoped.body.accessToken;
}

async function session(key: string, hoursFromNow: number, capacity: number) {
  const db = getOwnerDb();
  const type = await db.classType.findFirstOrThrow({ where: { gymId: w.gymA.id } });
  const room = await db.room.findFirstOrThrow({ where: { gymId: w.gymA.id } });
  const startsAt = new Date(Date.now() + hoursFromNow * 3_600_000);
  sessions[key] = (await db.classSession.create({ data: { gymId: w.gymA.id, classTypeId: type.id, trainerId: w.staff.ownerA.id, roomId: room.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), capacity } })).id;
}

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const db = getOwnerDb();
  const plan = await db.platformPlan.update({ where: { code: "TEST" }, data: { maxMembers: 100 } });
  for (const g of [w.gymA, w.gymB]) {
    await db.gym.update({ where: { id: g.id }, data: { status: "ACTIVE", timezone: TZ } });
    await db.gymSubscription.create({ data: { gymId: g.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  }
  planId = (await db.membershipPlan.create({ data: { gymId: w.gymA.id, name: "Monthly", type: "MONTHLY", priceMinor: 100, durationDays: 30 } })).id;
  packPlanId = (await db.membershipPlan.create({ data: { gymId: w.gymA.id, name: "Pack", type: "CLASS_PACK", priceMinor: 100, durationDays: 60, classCredits: 10 } })).id;
  const planB = (await db.membershipPlan.create({ data: { gymId: w.gymB.id, name: "Monthly", type: "MONTHLY", priceMinor: 100, durationDays: 30 } })).id;
  const locA = await db.location.create({ data: { gymId: w.gymA.id, name: "Main" } });
  await db.location.create({ data: { gymId: w.gymB.id, name: "Main" } });
  await db.room.create({ data: { gymId: w.gymA.id, locationId: locA.id, name: "Studio", capacity: 30 } });
  await db.classType.create({ data: { gymId: w.gymA.id, name: "Yoga", color: "#22c55e", durationMinutes: 60, defaultCapacity: 10 } });

  await memberWithAccount("alice", w.gymA.id, 1);
  await memberWithAccount("bea", w.gymA.id, 2, "pack", 2);
  await memberWithAccount("carl", w.gymA.id, 3);
  // Bob is a member of gym B.
  await memberWithAccount("bob", w.gymB.id, 4, "none");
  await db.membership.create({ data: { id: createId(), gymId: w.gymB.id, memberId: members.bob.memberId, planId: planB, startDate: fromDateString(addDays(today(), -10)), endDate: fromDateString(addDays(today(), 40)), priceMinor: 100 } });

  await session("tomorrow", 24, 2);
  await session("far", 24 * 20, 10); // beyond the 14-day booking window
  await session("soon", 1, 10); // inside the 2-hour cancellation cutoff

  // History: invoices/payments and check-ins for Alice and Bea.
  const inv = async (key: string, number: number) => {
    const i = await db.invoice.create({ data: { gymId: w.gymA.id, number, memberId: members[key].memberId, currency: "INR", subtotalMinor: 1000, taxMinor: 180, totalMinor: 1180, amountPaidMinor: 1180, status: "PAID", issuedAt: new Date(Date.now() - number * 86_400_000), dueDate: fromDateString(today()) } });
    await db.payment.create({ data: { gymId: w.gymA.id, memberId: members[key].memberId, invoiceId: i.id, amountMinor: 1180, currency: "INR", method: "CARD", receivedAt: new Date(Date.now() - number * 86_400_000), recordedById: w.staff.ownerA.id } });
    return i.id;
  };
  aliceInvoiceId = await inv("alice", 1);
  await inv("alice", 2);
  beaInvoiceId = await inv("bea", 3);
  for (const key of ["alice", "alice", "bea"]) {
    await db.checkIn.create({ data: { gymId: w.gymA.id, memberId: members[key].memberId, locationId: locA.id, method: "QR", result: "ALLOWED", checkedInAt: new Date(Date.now() - 86_400_000) } });
  }

  deskA = (await resolveTenant({ ...w.users.deskA, isSuperAdmin: false }, "gym-a"))!;
  deskB = (await resolveTenant({ ...w.users.ownerB, isSuperAdmin: false }, "gym-b"))!;
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("membership card and rotating QR", () => {
  it("returns the card with a short-lived code that checks the member in once", async () => {
    const token = await memberToken("alice");
    const card = await callApi<{ member: { name: string }; membership: { planName: string; state: string } | null; qr: { token: string; expiresAt: string; refreshInSeconds: number } }>(cardRoute.GET, { token });
    expect(card.status).toBe(200);
    expect(card.body.member.name).toBe("Alice Test");
    expect(card.body.membership).toMatchObject({ planName: "Monthly", state: "active" });
    expect(card.body.qr.refreshInSeconds).toBe(30);
    expect(new Date(card.body.qr.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(46_000);

    const found = await lookupForCheckIn(deskA, card.body.qr.token);
    expect(found.method).toBe("QR");
    expect(found.candidates.map((c) => c.id)).toEqual([members.alice.memberId]);
    const checked = await checkInMember(deskA, { memberId: members.alice.memberId, locationId: (await getOwnerDb().location.findFirstOrThrow({ where: { gymId: w.gymA.id } })).id, method: "QR" }, meta);
    expect(checked.result).toBe("ALLOWED");
    // The same code (a screenshot) can't be used again.
    await expect(lookupForCheckIn(deskA, card.body.qr.token)).rejects.toThrow(/already used/);
  });

  it("expired codes, codes from another gym and tampered codes are refused", async () => {
    const expired = mintMemberQr(w.gymA.id, members.alice.memberId, Date.now() - 60_000).token;
    await expect(lookupForCheckIn(deskA, expired)).rejects.toThrow(/expired/);
    const fresh = mintMemberQr(w.gymA.id, members.alice.memberId).token;
    await expect(lookupForCheckIn(deskB, fresh)).rejects.toThrow(/isn't valid at this gym/);
    const forged = mintMemberQr(w.gymA.id, members.alice.memberId).token.replace(members.alice.memberId, members.bea.memberId);
    await expect(lookupForCheckIn(deskA, forged)).rejects.toThrow(/isn't valid/);
  });

  it("a gym can turn printed codes off and accept only the app's code", async () => {
    await getOwnerDb().gym.update({ where: { id: w.gymA.id }, data: { acceptStaticCheckInCodes: false } });
    try {
      const desk = (await resolveTenant({ ...w.users.deskA, isSuperAdmin: false }, "gym-a"))!;
      await expect(lookupForCheckIn(desk, "FITCRM:MEMB000001")).rejects.toThrow(/Printed check-in codes are turned off/);
      expect((await lookupForCheckIn(desk, mintMemberQr(w.gymA.id, members.alice.memberId).token)).candidates).toHaveLength(1);
    } finally {
      await getOwnerDb().gym.update({ where: { id: w.gymA.id }, data: { acceptStaticCheckInCodes: true } });
    }
  });
});

describe("membership", () => {
  it("shows plan, state, dates and class credits", async () => {
    const r = await callApi<{ current: { planType: string; classCreditsRemaining: number | null; daysRemaining: number }; renewal: unknown; rules: { bookingDaysAhead: number } }>(membershipRoute.GET, { token: await memberToken("bea") });
    expect(r.body.current).toMatchObject({ planType: "CLASS_PACK", classCreditsRemaining: 2, daysRemaining: 41 }); // the end date itself still counts (same as the web)
    expect(r.body.renewal).toBeNull();
    expect(r.body.rules).toEqual({ bookingDaysAhead: 14, cancelHoursBefore: 2 });
  });
});

describe("class booking", () => {
  type Klass = { id: string; spotsLeft: number; canBook: boolean; canCancel: boolean; my: { bookingId: string; status: string; waitlistPosition: number | null } | null; trainer: string };
  const list = async (token: string) => (await callApi<{ classes: Klass[] }>(classesRoute.GET, { token })).body.classes;

  it("lists the timetable within the booking window, with trainer names and spots", async () => {
    const classes = await list(await memberToken("alice"));
    const ids = classes.map((c) => c.id);
    expect(ids).toContain(sessions.tomorrow);
    expect(ids).not.toContain(sessions.far);
    const t = classes.find((c) => c.id === sessions.tomorrow)!;
    expect(t).toMatchObject({ spotsLeft: 2, canBook: true, my: null, trainer: "Owner A" });
    // Gym B's member sees none of gym A's classes.
    expect((await list(await memberToken("bob", "gym-b"))).map((c) => c.id)).not.toContain(sessions.tomorrow);
  });

  it("books, spends a class-pack credit, waitlists when full, and promotes on cancel", async () => {
    const [alice, bea, carl] = [await memberToken("alice"), await memberToken("bea"), await memberToken("carl")];
    const a = await callApi<{ bookingId: string; status: string }>(bookRoute.POST, { method: "POST", token: alice, params: { sessionId: sessions.tomorrow } });
    expect(a.status).toBe(201);
    expect(a.body.status).toBe("BOOKED");
    expect((await callApi(bookRoute.POST, { method: "POST", token: alice, params: { sessionId: sessions.tomorrow } })).body.error?.message).toMatch(/Already booked/);
    expect((await callApi(bookRoute.POST, { method: "POST", token: bea, params: { sessionId: sessions.tomorrow } })).body).toMatchObject({ status: "BOOKED" });
    const credits = async () => (await getOwnerDb().membership.findFirstOrThrow({ where: { memberId: members.bea.memberId } })).classCreditsRemaining;
    expect(await credits()).toBe(1);
    const c = await callApi<{ status: string; waitlistPosition: number }>(bookRoute.POST, { method: "POST", token: carl, params: { sessionId: sessions.tomorrow } });
    expect(c.body).toMatchObject({ status: "WAITLISTED", waitlistPosition: 1 });

    const mine = (await list(alice)).find((k) => k.id === sessions.tomorrow)!;
    expect(mine).toMatchObject({ my: { status: "BOOKED" }, canCancel: true, canBook: false, spotsLeft: 0 });
    const cancelled = await callApi<{ creditReturned: boolean }>(cancelRoute.DELETE, { method: "DELETE", token: alice, params: { bookingId: a.body.bookingId } });
    expect(cancelled.status).toBe(200);
    expect((await list(carl)).find((k) => k.id === sessions.tomorrow)!.my).toMatchObject({ status: "BOOKED", waitlistPosition: null });

    const audit = await getOwnerDb().auditLog.findMany({ where: { gymId: w.gymA.id, actorType: "MEMBER" }, select: { action: true } });
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["booking.create", "booking.waitlist", "booking.cancel", "booking.promote"]));
  });

  it("enforces the gym's booking window and cancellation cutoff", async () => {
    const bea = await memberToken("bea");
    expect((await callApi(bookRoute.POST, { method: "POST", token: bea, params: { sessionId: sessions.far } })).body.error?.message).toMatch(/open for booking 14 days ahead/);
    const b = await callApi<{ bookingId: string }>(bookRoute.POST, { method: "POST", token: bea, params: { sessionId: sessions.soon } });
    expect(b.status).toBe(201);
    const tooLate = await callApi(cancelRoute.DELETE, { method: "DELETE", token: bea, params: { bookingId: b.body.bookingId } });
    expect(tooLate.status).toBe(422);
    expect(tooLate.body.error?.message).toMatch(/up to 2 hours before/);
  });

  it("never overbooks when many members book the last spots at once", async () => {
    await session("rush", 30, 3);
    const keys = Array.from({ length: 8 }, (_, i) => `rush${i}`);
    for (const [i, k] of keys.entries()) await memberWithAccount(k, w.gymA.id, 200 + i);
    const tokens = await Promise.all(keys.map((k) => memberToken(k)));
    const results = await Promise.all(tokens.map((token) => callApi<{ status: string; waitlistPosition: number | null }>(bookRoute.POST, { method: "POST", token, params: { sessionId: sessions.rush } })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(results.filter((r) => r.body.status === "BOOKED")).toHaveLength(3);
    expect(results.map((r) => r.body.waitlistPosition).filter(Boolean).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await getOwnerDb().booking.count({ where: { sessionId: sessions.rush, status: "BOOKED" } })).toBe(3);
  });

  it("members can't touch other members' bookings or other gyms' classes", async () => {
    const carlBooking = await getOwnerDb().booking.findFirstOrThrow({ where: { memberId: members.carl.memberId, sessionId: sessions.tomorrow } });
    const alice = await memberToken("alice");
    expect((await callApi(cancelRoute.DELETE, { method: "DELETE", token: alice, params: { bookingId: carlBooking.id } })).status).toBe(404);
    const bob = await memberToken("bob", "gym-b");
    expect((await callApi(bookRoute.POST, { method: "POST", token: bob, params: { sessionId: sessions.tomorrow } })).status).toBe(404);
  });

  it("is refused when the plan has no class bookings or the gym is read-only", async () => {
    const db = getOwnerDb();
    const alice = await memberToken("alice");
    await db.platformPlan.update({ where: { code: "TEST" }, data: { featureClassBookings: false } });
    try {
      expect((await callApi(bookRoute.POST, { method: "POST", token: alice, params: { sessionId: sessions.rush } })).status).toBe(403);
    } finally {
      await db.platformPlan.update({ where: { code: "TEST" }, data: { featureClassBookings: true } });
    }
    await db.gym.update({ where: { id: w.gymA.id }, data: { status: "SUSPENDED" } });
    try {
      expect((await callApi(bookRoute.POST, { method: "POST", token: alice, params: { sessionId: sessions.rush } })).body.error?.message).toMatch(/paused/);
    } finally {
      await db.gym.update({ where: { id: w.gymA.id }, data: { status: "ACTIVE" } });
    }
  });

  it("the member booking context can only move class credits, one at a time", async () => {
    const alice = await getOwnerDb().user.findUniqueOrThrow({ where: { email: members.alice.email } });
    const ctx = { userId: alice.id, gymId: w.gymA.id, memberId: members.alice.memberId };
    const beaMs = await getOwnerDb().membership.findFirstOrThrow({ where: { memberId: members.bea.memberId } });
    await expect(withMemberAction(ctx, (tx) => tx.membership.update({ where: { id: beaMs.id }, data: { endDate: fromDateString(addDays(today(), 400)) } }))).rejects.toThrow(/one class credit/);
    await expect(withMemberAction(ctx, (tx) => tx.membership.update({ where: { id: beaMs.id }, data: { classCreditsRemaining: 99 } }))).rejects.toThrow(/one class credit/);
    // Outside a booking action, a member can't change memberships at all.
    const r = await withMemberAction({ ...ctx, memberId: "not-mine" }, (tx) => tx.membership.updateMany({ where: { id: beaMs.id }, data: { classCreditsRemaining: { increment: 1 } } }));
    expect(r.count).toBe(0);
  });
});

describe("history", () => {
  it("attendance, payments and invoices are the member's own, newest first, paginated", async () => {
    const alice = await memberToken("alice");
    const att = await callApi<{ items: { allowed: boolean; location: string }[] }>(attendanceRoute.GET, { token: alice });
    expect(att.body.items.length).toBe(3); // 2 seeded + today's QR check-in
    const p1 = await callApi<{ items: { id: string; invoice: { number: string } }[]; nextCursor: string | null }>(paymentsRoute.GET, { token: alice, query: { limit: "1" } });
    expect(p1.body.items).toHaveLength(1);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await callApi<{ items: { id: string }[]; nextCursor: string | null }>(paymentsRoute.GET, { token: alice, query: { limit: "1", cursor: p1.body.nextCursor! } });
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
    expect(p2.body.nextCursor).toBeNull();
    const invoices = await callApi<{ items: { id: string; number: string; status: string }[] }>(invoicesRoute.GET, { token: alice });
    expect(invoices.body.items.map((i) => i.id)).not.toContain(beaInvoiceId);
    const detail = await callApi<{ number: string; payments: unknown[]; gym: { name: string } }>(invoiceRoute.GET, { token: alice, params: { invoiceId: aliceInvoiceId } });
    expect(detail.body).toMatchObject({ number: "INV-000001", gym: { name: "Gym A" } });
    expect(detail.body.payments).toHaveLength(1);
    // Another member's invoice doesn't exist as far as Alice is concerned.
    expect((await callApi(invoiceRoute.GET, { token: alice, params: { invoiceId: beaInvoiceId } })).status).toBe(404);
  });

  it("staff tokens can't use member endpoints", async () => {
    const staff = await callApi<{ accessToken: string }>(loginRoute.POST, { body: { identifier: "desk.a@test.example", password: PASSWORD, device: device() } });
    expect(staff.status).toBe(401); // fixture staff have placeholder passwords
    await getOwnerDb().user.update({ where: { id: w.users.deskA.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
    const login = await callApi<{ accessToken: string }>(loginRoute.POST, { body: { identifier: "desk.a@test.example", password: PASSWORD, device: device() } });
    const scoped = await callApi<{ accessToken: string }>(selectGymRoute.POST, { token: login.body.accessToken, body: { gymSlug: "gym-a" } });
    expect((await callApi(cardRoute.GET, { token: scoped.body.accessToken })).status).toBe(403);
    expect((await callApi(invoicesRoute.GET, { token: scoped.body.accessToken })).status).toBe(403);
  });
});
