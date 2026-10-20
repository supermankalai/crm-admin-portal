import { existsSync } from "node:fs";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as announcementsRoute from "@/app/api/mobile/v1/announcements/route";
import * as loginRoute from "@/app/api/mobile/v1/auth/login/route";
import * as logoutRoute from "@/app/api/mobile/v1/auth/logout/route";
import * as selectGymRoute from "@/app/api/mobile/v1/auth/select-gym/route";
import * as gymRoute from "@/app/api/mobile/v1/gym/route";
import * as prefsRoute from "@/app/api/mobile/v1/me/notification-preferences/route";
import * as pushTokenRoute from "@/app/api/mobile/v1/me/push-token/route";
import * as cancelRoute from "@/app/api/mobile/v1/member/bookings/[bookingId]/route";
import * as deletionRoute from "@/app/api/mobile/v1/member/deletion-request/route";
import * as profileRoute from "@/app/api/mobile/v1/member/profile/route";
import * as readRoute from "@/app/api/mobile/v1/notifications/[notificationId]/read/route";
import * as readAllRoute from "@/app/api/mobile/v1/notifications/read-all/route";
import * as inboxRoute from "@/app/api/mobile/v1/notifications/route";
import { addDays, fromDateString, localDate } from "@/domain/dates";
import { hashPassword } from "@/server/auth/password";
import { decryptField } from "@/server/crypto";
import { appDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { generateGymNotifications } from "@/server/notifications";
import { checkPushReceipts, deliverPendingPushes, PUSH_MAX_AGE_MS } from "@/server/push/deliver";
import type { PushMessage, PushProvider, PushReceipt, PushTicket } from "@/server/push/provider";
import { publishAnnouncement } from "@/server/services/announcements";
import { completeDeletionRequest, rejectDeletionRequest } from "@/server/services/deletion-requests";
import { getStorage } from "@/server/storage";
import { resolveTenant } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { createTwoGyms, type World } from "../support/fixtures";
import { callApi, device } from "../support/mobile-api";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/** Mobile Phase 6: inbox, preferences, push delivery, announcements, profile and account deletion. */

const TZ = "Asia/Kolkata";
const PASSWORD = "Notify-Pass-2026";
const meta = { ip: "127.0.0.1", userAgent: "vitest" };
let w: World;
let ownerA: TenantContext;
let deskA: TenantContext;
const m: Record<string, { memberId: string; userId: string; email: string }> = {};
const tok = (n: number) => `ExponentPushToken[device-${String(n).padStart(4, "0")}-abcdefgh]`;
const today = () => localDate(new Date(), TZ);

/** A fake Expo: records messages; tokens listed in `gone` are reported as no longer registered. */
class FakePush implements PushProvider {
  sent: PushMessage[] = [];
  gone = new Set<string>();
  goneLater = new Set<string>();
  private ticketTo = new Map<string, string>();
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return messages.map((msg) => {
      if (this.gone.has(msg.to)) return { status: "error", error: "DeviceNotRegistered" };
      const id = createId();
      this.ticketTo.set(id, msg.to);
      return { status: "ok", id };
    });
  }
  async receipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ids.map((id) => [id, this.goneLater.has(this.ticketTo.get(id) ?? "") ? { status: "error" as const, error: "DeviceNotRegistered" } : { status: "ok" as const }]));
  }
}

async function login(email: string, slug: string, name = "Test phone") {
  const l = await callApi<{ accessToken: string }>(loginRoute.POST, { body: { identifier: email, password: PASSWORD, device: device(name) } });
  const s = await callApi<{ accessToken: string }>(selectGymRoute.POST, { token: l.body.accessToken, body: { gymSlug: slug } });
  if (s.status !== 200) throw new Error(`select-gym ${email} ${s.status}`);
  return s.body.accessToken;
}

async function member(key: string, gymId: string, n: number) {
  const db = getOwnerDb();
  const email = `${key}@notify.test`;
  const row = await db.member.create({ data: { gymId, memberNumber: 200 + n, firstName: key[0].toUpperCase() + key.slice(1), lastName: "Test", email, checkInCode: `NOTI${String(n).padStart(6, "0")}` } });
  const u = await db.user.create({ data: { email, name: `${key} test`, passwordHash: await hashPassword(PASSWORD) } });
  await db.memberAccount.create({ data: { gymId, memberId: row.id, userId: u.id } });
  m[key] = { memberId: row.id, userId: u.id, email };
}

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const db = getOwnerDb();
  await db.user.updateMany({ data: { passwordHash: await hashPassword(PASSWORD) } });
  const plan = await db.platformPlan.update({ where: { code: "TEST" }, data: { maxMembers: 100 } });
  for (const g of [w.gymA, w.gymB]) {
    await db.gym.update({ where: { id: g.id }, data: { status: "ACTIVE", timezone: TZ } });
    await db.gymSubscription.create({ data: { gymId: g.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  }
  await member("ana", w.gymA.id, 1);
  await member("ben", w.gymA.id, 2);
  await member("cara", w.gymB.id, 3);
  ownerA = (await resolveTenant({ ...w.users.ownerA, isSuperAdmin: false }, "gym-a"))!;
  deskA = (await resolveTenant({ ...w.users.deskA, isSuperAdmin: false }, "gym-a"))!;
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("inbox", () => {
  it("each person sees, and marks read, only their own notifications", async () => {
    const db = getOwnerDb();
    const mk = (userId: string, gymId: string, title: string) => ({ gymId, recipientUserId: userId, type: "SYSTEM" as const, title, body: "x", dedupeKey: createId(), pushedAt: new Date() });
    await db.notification.createMany({ data: [mk(m.ana.userId, w.gymA.id, "For Ana"), mk(m.ana.userId, w.gymA.id, "For Ana 2"), mk(m.ben.userId, w.gymA.id, "For Ben"), mk(w.users.ownerA.id, w.gymA.id, "For owner")] });
    const ana = await login(m.ana.email, "gym-a");
    const inbox = await callApi<{ items: { id: string; title: string }[]; unread: number }>(inboxRoute.GET, { token: ana });
    expect(inbox.body.items.map((i) => i.title).sort()).toEqual(["For Ana", "For Ana 2"]);
    expect(inbox.body.unread).toBe(2);

    const bens = await db.notification.findFirstOrThrow({ where: { recipientUserId: m.ben.userId } });
    expect((await callApi(readRoute.POST, { token: ana, params: { notificationId: bens.id } })).status).toBe(404);
    expect((await callApi(readRoute.POST, { token: ana, params: { notificationId: inbox.body.items[0].id } })).status).toBe(200);
    expect((await callApi<{ marked: number }>(readAllRoute.POST, { token: ana })).body.marked).toBe(1);
    expect((await db.notification.findUniqueOrThrow({ where: { id: bens.id } })).readAt).toBeNull();

    const owner = await login(w.users.ownerA.email, "gym-a");
    const ownerInbox = await callApi<{ items: { title: string }[] }>(inboxRoute.GET, { token: owner });
    expect(ownerInbox.body.items.map((i) => i.title)).toEqual(["For owner"]);
  });

  it("pages newest first with a cursor", async () => {
    const db = getOwnerDb();
    await db.notification.createMany({ data: Array.from({ length: 5 }, (_, i) => ({ gymId: w.gymA.id, recipientUserId: m.ben.userId, type: "SYSTEM" as const, title: `n${i}`, body: "x", dedupeKey: createId(), pushedAt: new Date(), createdAt: new Date(Date.now() - i * 60_000) })) });
    const ben = await login(m.ben.email, "gym-a");
    const p1 = await callApi<{ items: { title: string }[]; nextCursor: string }>(inboxRoute.GET, { token: ben, query: { limit: "3" } });
    const p2 = await callApi<{ items: { title: string }[]; nextCursor: string | null }>(inboxRoute.GET, { token: ben, query: { limit: "3", cursor: p1.body.nextCursor } });
    expect([...p1.body.items, ...p2.body.items].map((i) => i.title).filter((t) => t.startsWith("n"))).toEqual(["n0", "n1", "n2", "n3", "n4"]);
  });
});

describe("preferences and push tokens", () => {
  it("offers members member categories and staff the staff ones; ignores the rest", async () => {
    const ana = await login(m.ana.email, "gym-a");
    const p = await callApi<{ available: string[] }>(prefsRoute.GET, { token: ana });
    expect(p.body.available).toEqual(["classReminders", "waitlist", "membership", "payments", "announcements"]);
    const u = await callApi<{ preferences: Record<string, boolean> }>(prefsRoute.PUT, { token: ana, body: { classReminders: false, staffAlerts: false } });
    expect(u.body.preferences).toMatchObject({ classReminders: false, staffAlerts: true });
    const desk = await login(w.users.deskA.email, "gym-a");
    expect((await callApi<{ available: string[] }>(prefsRoute.GET, { token: desk })).body.available).toEqual(["announcements", "staffAlerts"]);
    await callApi(prefsRoute.PUT, { token: ana, body: { classReminders: true } });
  });

  it("registers one token per device per gym, refuses junk, and removes them on logout", async () => {
    const db = getOwnerDb();
    const ben = await login(m.ben.email, "gym-a", "Ben's phone");
    expect((await callApi(pushTokenRoute.POST, { token: ben, body: { token: "not-a-token", platform: "android" } })).status).toBe(422);
    expect((await callApi(pushTokenRoute.POST, { token: ben, body: { token: tok(1), platform: "android" } })).status).toBe(200);
    expect((await callApi(pushTokenRoute.POST, { token: ben, body: { token: tok(2), platform: "android" } })).status).toBe(200);
    const rows = await db.pushToken.findMany({ where: { userId: m.ben.userId } });
    expect(rows.map((r) => r.token)).toEqual([tok(2)]);
    expect((await callApi(logoutRoute.POST, { token: ben })).status).toBe(200);
    expect(await db.pushToken.count({ where: { userId: m.ben.userId } })).toBe(0);
  });
});

describe("push delivery", () => {
  let push: FakePush;
  beforeEach(async () => {
    push = new FakePush();
    const db = getOwnerDb();
    await db.notification.updateMany({ where: { pushedAt: null }, data: { pushedAt: new Date() } });
  });

  it("sends generic lock-screen text, once, to live devices of people still in the gym", async () => {
    const db = getOwnerDb();
    const ana = await login(m.ana.email, "gym-a", "Ana's phone");
    await callApi(pushTokenRoute.POST, { token: ana, body: { token: tok(10), platform: "ios" } });
    await db.notification.create({
      data: { gymId: w.gymA.id, recipientUserId: m.ana.userId, type: "PAYMENT_DUE", title: "Payment due soon", body: "Invoice INV-000042 for Ana Test is due on 20 Oct.", dedupeKey: createId() },
    });
    const r = await deliverPendingPushes(getOwnerDb(), push);
    expect(r).toMatchObject({ sent: 1 });
    expect(push.sent).toHaveLength(1);
    const msg = push.sent[0];
    expect(msg).toMatchObject({ to: tok(10), title: "Gym A", body: "You have a payment due. Open the app for details.", data: { type: "PAYMENT_DUE", gymSlug: "gym-a" } });
    expect(JSON.stringify(msg)).not.toMatch(/INV-|Ana|Test|20 Oct/);

    expect((await deliverPendingPushes(getOwnerDb(), push)).sent).toBe(0); // never twice
  });

  it("respects preferences, skips signed-out devices and stale news", async () => {
    const db = getOwnerDb();
    const ana = await login(m.ana.email, "gym-a", "Ana's tablet");
    await callApi(pushTokenRoute.POST, { token: ana, body: { token: tok(11), platform: "android" } });
    await callApi(prefsRoute.PUT, { token: ana, body: { classReminders: false } });
    await db.notification.createMany({
      data: [
        { gymId: w.gymA.id, recipientUserId: m.ana.userId, type: "CLASS_REMINDER", title: "t", body: "b", dedupeKey: createId() },
        { gymId: w.gymA.id, recipientUserId: m.ana.userId, type: "WAITLIST_PROMOTED", title: "t", body: "b", dedupeKey: createId(), createdAt: new Date(Date.now() - PUSH_MAX_AGE_MS - 60_000) },
      ],
    });
    await deliverPendingPushes(getOwnerDb(), push);
    expect(push.sent).toEqual([]);
    await callApi(prefsRoute.PUT, { token: ana, body: { classReminders: true } });

    // A device whose session was revoked (e.g. password change) gets nothing.
    await db.mobileDeviceSession.updateMany({ where: { userId: m.ana.userId }, data: { revokedAt: new Date() } });
    await db.notification.create({ data: { gymId: w.gymA.id, recipientUserId: m.ana.userId, type: "ANNOUNCEMENT", title: "t", body: "b", dedupeKey: createId() } });
    await deliverPendingPushes(getOwnerDb(), push);
    expect(push.sent).toEqual([]);
  });

  it("drops tokens Expo reports as no longer registered (at send and from receipts)", async () => {
    const db = getOwnerDb();
    const ben = await login(m.ben.email, "gym-a", "Ben's old phone");
    await callApi(pushTokenRoute.POST, { token: ben, body: { token: tok(20), platform: "android" } });
    const ben2 = await login(m.ben.email, "gym-a", "Ben's new phone");
    await callApi(pushTokenRoute.POST, { token: ben2, body: { token: tok(21), platform: "android" } });
    push.gone.add(tok(20));
    push.goneLater.add(tok(21));
    await db.notification.create({ data: { gymId: w.gymA.id, recipientUserId: m.ben.userId, type: "ANNOUNCEMENT", title: "t", body: "b", dedupeKey: createId() } });
    await deliverPendingPushes(getOwnerDb(), push);
    expect((await db.pushToken.findFirstOrThrow({ where: { token: tok(20) } })).invalidatedAt).not.toBeNull();
    // Receipts are checked 15 minutes later.
    expect((await checkPushReceipts(getOwnerDb(), push, new Date(Date.now() + 16 * 60_000))).invalidated).toBe(1);
    expect((await db.pushToken.findFirstOrThrow({ where: { token: tok(21) } })).invalidatedAt).not.toBeNull();
  });
});

describe("reminders and alerts", () => {
  it("creates class reminders, membership and payment reminders for app members, and full-class alerts for staff — once", async () => {
    const db = getOwnerDb();
    const loc = await db.location.create({ data: { gymId: w.gymA.id, name: "Main" } });
    const room = await db.room.create({ data: { gymId: w.gymA.id, locationId: loc.id, name: "Studio", capacity: 10 } });
    const type = await db.classType.create({ data: { gymId: w.gymA.id, name: "Spin", color: "#3b82f6", durationMinutes: 45, defaultCapacity: 1 } });
    const startsAt = new Date(Date.now() + 60 * 60_000);
    const session = await db.classSession.create({ data: { gymId: w.gymA.id, classTypeId: type.id, trainerId: w.staff.ownerA.id, roomId: room.id, startsAt, endsAt: new Date(startsAt.getTime() + 45 * 60_000), capacity: 1 } });
    await db.booking.create({ data: { gymId: w.gymA.id, sessionId: session.id, memberId: m.ana.memberId, status: "BOOKED" } });
    const plan = await db.membershipPlan.create({ data: { gymId: w.gymA.id, name: "Monthly", type: "MONTHLY", priceMinor: 100, durationDays: 30 } });
    await db.membership.create({ data: { id: createId(), gymId: w.gymA.id, memberId: m.ana.memberId, planId: plan.id, startDate: fromDateString(addDays(today(), -27)), endDate: fromDateString(addDays(today(), 3)), priceMinor: 100 } });
    await db.invoice.create({ data: { gymId: w.gymA.id, number: 7, memberId: m.ana.memberId, currency: "INR", subtotalMinor: 100, taxMinor: 0, totalMinor: 100, amountPaidMinor: 0, status: "OPEN", issuedAt: new Date(), dueDate: fromDateString(addDays(today(), 2)) } });

    const since = new Date();
    await db.$transaction((tx) => generateGymNotifications(tx, w.gymA.id));
    const anas = await db.notification.findMany({ where: { recipientUserId: m.ana.userId, createdAt: { gte: since }, type: { in: ["CLASS_REMINDER", "MEMBERSHIP_EXPIRING", "PAYMENT_DUE"] } } });
    expect(anas.map((n) => n.type).sort()).toEqual(["CLASS_REMINDER", "MEMBERSHIP_EXPIRING", "PAYMENT_DUE"]);
    expect(anas.find((n) => n.type === "CLASS_REMINDER")!.body).toMatch(/^Spin starts at /);
    const full = await db.notification.findMany({ where: { type: "CLASS_FULL", gymId: w.gymA.id } });
    expect(full.map((n) => n.recipientUserId).sort()).toEqual([w.users.ownerA.id, w.users.deskA.id].sort());
    const before = await db.notification.count();
    await db.$transaction((tx) => generateGymNotifications(tx, w.gymA.id));
    expect(await db.notification.count()).toBe(before);
    expect(await db.notification.count({ where: { gymId: w.gymB.id, type: { in: ["CLASS_REMINDER", "CLASS_FULL"] } } })).toBe(0);
  });

  it("tells a waitlisted member when a cancellation moves them in", async () => {
    const db = getOwnerDb();
    const type = await db.classType.findFirstOrThrow({ where: { gymId: w.gymA.id } });
    const room = await db.room.findFirstOrThrow({ where: { gymId: w.gymA.id } });
    const plan = await db.membershipPlan.findFirstOrThrow({ where: { gymId: w.gymA.id } });
    await db.membership.create({ data: { id: createId(), gymId: w.gymA.id, memberId: m.ben.memberId, planId: plan.id, startDate: fromDateString(addDays(today(), -5)), endDate: fromDateString(addDays(today(), 25)), priceMinor: 100 } });
    const startsAt = new Date(Date.now() + 2 * 86_400_000);
    const s = await db.classSession.create({ data: { gymId: w.gymA.id, classTypeId: type.id, trainerId: w.staff.ownerA.id, roomId: room.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), capacity: 1 } });
    const anaBooking = await db.booking.create({ data: { gymId: w.gymA.id, sessionId: s.id, memberId: m.ana.memberId, status: "BOOKED" } });
    const benBooking = await db.booking.create({ data: { gymId: w.gymA.id, sessionId: s.id, memberId: m.ben.memberId, status: "WAITLISTED", waitlistPosition: 1 } });
    const ana = await login(m.ana.email, "gym-a");
    expect((await callApi(cancelRoute.DELETE, { token: ana, params: { bookingId: anaBooking.id } })).status).toBe(200);
    const note = await db.notification.findFirst({ where: { recipientUserId: m.ben.userId, type: "WAITLIST_PROMOTED", entityId: benBooking.id } });
    expect(note?.body).toMatch(/Spin/);
  });
});

describe("announcements", () => {
  it("reaches the right audience, in this gym only; front desk can't publish", async () => {
    await publishAnnouncement(ownerA, { title: "Closed on Friday", body: "Public holiday.", audience: "EVERYONE" }, meta);
    await publishAnnouncement(ownerA, { title: "Staff party", body: "Thursday 7 pm.", audience: "STAFF" }, meta);
    await expect(publishAnnouncement(deskA, { title: "x", body: "y", audience: "EVERYONE" }, meta)).rejects.toThrow();
    const ana = await login(m.ana.email, "gym-a");
    expect((await callApi<{ items: { title: string }[] }>(announcementsRoute.GET, { token: ana })).body.items.map((a) => a.title)).toEqual(["Closed on Friday"]);
    const desk = await login(w.users.deskA.email, "gym-a");
    expect((await callApi<{ items: { title: string }[] }>(announcementsRoute.GET, { token: desk })).body.items.map((a) => a.title).sort()).toEqual(["Closed on Friday", "Staff party"]);
    const cara = await login(m.cara.email, "gym-b");
    expect((await callApi<{ items: unknown[] }>(announcementsRoute.GET, { token: cara })).body.items).toEqual([]);
    expect(await getOwnerDb().notification.count({ where: { recipientUserId: m.ana.userId, type: "ANNOUNCEMENT", entityType: "Announcement" } })).toBe(1);
    expect(await getOwnerDb().notification.count({ where: { recipientUserId: w.users.deskA.id, type: "ANNOUNCEMENT", entityType: "Announcement" } })).toBe(2);
  });

  it("pushes only the title for announcements", async () => {
    const push = new FakePush();
    const db = getOwnerDb();
    await db.notification.updateMany({ where: { pushedAt: null }, data: { pushedAt: new Date() } });
    const ana = await login(m.ana.email, "gym-a", "Ana's watch");
    await callApi(pushTokenRoute.POST, { token: ana, body: { token: tok(30), platform: "ios" } });
    await publishAnnouncement(ownerA, { title: "Pool reopens", body: "The pool reopens Monday after maintenance.", audience: "MEMBERS" }, meta);
    await deliverPendingPushes(getOwnerDb(), push);
    expect(push.sent.find((p) => p.to === tok(30))).toMatchObject({ title: "Gym A", body: "New announcement: Pool reopens" });
  });
});

describe("profile", () => {
  it("updates the member's own contact details, encrypted, audited by field name only", async () => {
    const ana = await login(m.ana.email, "gym-a");
    const r = await callApi<{ phone: string; address: string; emergencyContact: { name: string } }>(profileRoute.PATCH, {
      token: ana,
      body: { email: "ana.new@notify.test", phone: "+91 98765 43210", address: "12 MG Road", emergencyContact: { name: "Raj", phone: "+91 98765 00000", relation: "Brother" } },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ phone: "+91 98765 43210", address: "12 MG Road", emergencyContact: { name: "Raj" } });
    const row = await getOwnerDb().member.findUniqueOrThrow({ where: { id: m.ana.memberId } });
    expect(row.phoneEnc).not.toContain("98765");
    expect(decryptField(row.addressEnc!, { gymId: w.gymA.id, model: "Member", field: "address", recordId: m.ana.memberId })).toBe("12 MG Road");
    const audit = await getOwnerDb().auditLog.findFirstOrThrow({ where: { action: "member.self_update", entityId: m.ana.memberId } });
    expect(audit.actorType).toBe("MEMBER");
    expect(JSON.stringify(audit.changes)).not.toMatch(/MG Road|98765|Raj/);
    const bad = await callApi(profileRoute.PATCH, { token: ana, body: { email: "", phone: "12", address: "", emergencyContact: { name: "", phone: "", relation: "" } } });
    expect(bad.status).toBe(422);
  });
});

describe("account deletion", () => {
  it("files one request, alerts managers, and erases the member when completed", async () => {
    const db = getOwnerDb();
    const ben = await login(m.ben.email, "gym-a");
    expect((await callApi(deletionRoute.POST, { token: ben, body: { reason: "Moving away", confirm: false } })).status).toBe(422);
    expect((await callApi(deletionRoute.POST, { token: ben, body: { reason: "Moving away", confirm: true } })).status).toBe(201);
    expect((await callApi(deletionRoute.POST, { token: ben, body: { reason: "", confirm: true } })).status).toBe(409);
    expect(await db.notification.count({ where: { type: "DELETION_REQUEST", recipientUserId: w.users.ownerA.id } })).toBe(1);
    expect(await db.notification.count({ where: { type: "DELETION_REQUEST", recipientUserId: w.users.deskA.id } })).toBe(0);
    const req = await db.accountDeletionRequest.findFirstOrThrow({ where: { memberId: m.ben.memberId } });
    expect(req.reasonEnc).not.toContain("Moving");

    // Fitness data, including a photo file only the member could see.
    const key = `${w.gymA.id}/progress-photo/${createId()}.jpg`;
    await getStorage().put(key, Buffer.from([0xff, 0xd8, 0xff, 0x00]));
    await db.progressPhoto.create({ data: { gymId: w.gymA.id, memberId: m.ben.memberId, takenOn: fromDateString(today()), storageKey: key, mimeType: "image/jpeg", sizeBytes: 4, sha256: "x" } });
    await db.progressEntry.create({ data: { gymId: w.gymA.id, memberId: m.ben.memberId, recordedOn: fromDateString(today()), measurementsEnc: "v1.x.y.z" } });

    await expect(completeDeletionRequest(deskA, req.id, null, meta)).rejects.toThrow();
    await completeDeletionRequest(ownerA, req.id, "Done as asked", meta);
    const row = await db.member.findUniqueOrThrow({ where: { id: m.ben.memberId } });
    expect(row).toMatchObject({ firstName: "Deleted", email: null, phoneEnc: null, addressEnc: null, emergencyContactEnc: null });
    expect(row.deletedAt).not.toBeNull();
    expect((await db.memberAccount.findFirstOrThrow({ where: { memberId: m.ben.memberId } })).status).toBe("DISABLED");
    expect(await db.progressPhoto.count({ where: { memberId: m.ben.memberId } })).toBe(0);
    expect(await db.progressEntry.count({ where: { memberId: m.ben.memberId } })).toBe(0);
    expect(await db.notification.count({ where: { recipientUserId: m.ben.userId, gymId: w.gymA.id } })).toBe(0);
    expect(existsSync(path.resolve(getEnv().STORAGE_DIR, key))).toBe(false);
    // Their app session no longer works in this gym.
    expect((await callApi(gymRoute.GET, { token: ben })).status).toBeGreaterThanOrEqual(401);
    await expect(completeDeletionRequest(ownerA, req.id, null, meta)).rejects.toThrow(/already been handled/);
  });

  it("can be rejected with a note the member sees", async () => {
    const ana = await login(m.ana.email, "gym-a");
    await callApi(deletionRoute.POST, { token: ana, body: { reason: "", confirm: true } });
    const req = await getOwnerDb().accountDeletionRequest.findFirstOrThrow({ where: { memberId: m.ana.memberId } });
    await rejectDeletionRequest(ownerA, req.id, "Please settle your open invoice first.", meta);
    const p = await callApi<{ deletionRequest: { status: string; note: string } }>(profileRoute.GET, { token: ana });
    expect(p.body.deletionRequest).toMatchObject({ status: "REJECTED", note: "Please settle your open invoice first." });
  });
});
