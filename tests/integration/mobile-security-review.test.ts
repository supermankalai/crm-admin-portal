import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as loginRoute from "@/app/api/mobile/v1/auth/login/route";
import * as selectGymRoute from "@/app/api/mobile/v1/auth/select-gym/route";
import * as staffMembersRoute from "@/app/api/mobile/v1/staff/members/route";
import { hashPassword } from "@/server/auth/password";
import { appDb } from "@/server/db/client";
import { withTenant } from "@/server/db/context";
import { deliverPendingPushes, DEVICE_IDLE_MS } from "@/server/push/deliver";
import type { PushMessage, PushProvider, PushTicket } from "@/server/push/provider";
import { createTwoGyms, type World } from "../support/fixtures";
import { callApi, device } from "../support/mobile-api";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/** Regression tests for the mobile Phase 7 security review fixes. */

const PASSWORD = "Review-Pass-2026";
let w: World;
let trainerUserId = "";

class RecordingPush implements PushProvider {
  sent: PushMessage[] = [];
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return messages.map(() => ({ status: "ok", id: createId() }));
  }
  async receipts() {
    return {};
  }
}

async function staffToken(email: string) {
  const l = await callApi<{ accessToken: string }>(loginRoute.POST, { body: { identifier: email, password: PASSWORD, device: device() } });
  return (await callApi<{ accessToken: string }>(selectGymRoute.POST, { token: l.body.accessToken, body: { gymSlug: "gym-a" } })).body.accessToken;
}

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const db = getOwnerDb();
  await db.user.updateMany({ data: { passwordHash: await hashPassword(PASSWORD) } });
  const plan = await db.platformPlan.findUniqueOrThrow({ where: { code: "TEST" } });
  for (const g of [w.gymA, w.gymB]) {
    await db.gym.update({ where: { id: g.id }, data: { status: "ACTIVE" } });
    await db.gymSubscription.create({ data: { gymId: g.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  }
  const trainer = await db.user.create({ data: { email: "trainer@review.test", name: "Trainer", passwordHash: await hashPassword(PASSWORD) } });
  trainerUserId = trainer.id;
  await db.staffMember.create({ data: { gymId: w.gymA.id, userId: trainer.id, role: "TRAINER" } });
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("request size", () => {
  it("refuses an oversized body even without a Content-Length header", async () => {
    const big = JSON.stringify({ identifier: "x".repeat(80 * 1024), password: "y", device: device() });
    const r = await callApi(loginRoute.POST, { rawBody: big });
    expect(r.status).toBe(413);
  });
});

describe("validation", () => {
  it("rejects page cursor 0 with a 422, not a server error", async () => {
    const token = await staffToken(w.users.ownerA.email);
    expect((await callApi(staffMembersRoute.GET, { token, query: { cursor: "0" } })).status).toBe(422);
  });
});

describe("member app accounts in the database", () => {
  it("trainers can read but not change member app accounts or invites (RLS)", async () => {
    const db = getOwnerDb();
    const u = await db.user.create({ data: { email: "m@review.test", name: "M", passwordHash: "x" } });
    await db.memberAccount.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, userId: u.id } });
    const seen = await withTenant({ userId: trainerUserId, gymId: w.gymA.id }, (tx) => tx.memberAccount.count());
    expect(seen).toBe(1);
    const changed = await withTenant({ userId: trainerUserId, gymId: w.gymA.id }, (tx) => tx.memberAccount.updateMany({ data: { status: "DISABLED" } }));
    expect(changed.count).toBe(0);
    await expect(
      withTenant({ userId: trainerUserId, gymId: w.gymA.id }, (tx) =>
        tx.memberAppInvite.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, channel: "CODE", tokenHash: createId(), email: "a@x.test", expiresAt: new Date(Date.now() + 60_000), createdById: w.staff.ownerA.id } })
      )
    ).rejects.toThrow(/row-level security/);
    const deskChanged = await withTenant({ userId: w.users.deskA.id, gymId: w.gymA.id }, (tx) => tx.memberAccount.updateMany({ data: { status: "DISABLED" } }));
    expect(deskChanged.count).toBe(1);
  });
});

describe("push delivery", () => {
  async function registerDevice(userId: string, gymId: string, token: string, lastSeenAt = new Date()) {
    const db = getOwnerDb();
    const session = await db.mobileDeviceSession.create({ data: { userId, deviceName: "phone", platform: "android", appVersion: "1", sessionVersion: 0, lastSeenAt } });
    return db.pushToken.create({ data: { gymId, userId, deviceSessionId: session.id, token, platform: "android" } });
  }
  const alert = (userId: string) => getOwnerDb().notification.create({ data: { gymId: w.gymA.id, recipientUserId: userId, type: "ANNOUNCEMENT", title: "t", body: "b", dedupeKey: createId() } });

  it("skips idle devices, gyms whose plan dropped the app, and older owners of a shared token", async () => {
    const db = getOwnerDb();
    await db.notification.updateMany({ where: { pushedAt: null }, data: { pushedAt: new Date() } });
    await registerDevice(w.users.ownerA.id, w.gymA.id, "ExponentPushToken[idle-device-0001]", new Date(Date.now() - DEVICE_IDLE_MS - 86_400_000));
    // The same phone, signed in by the desk user first and the owner later: only the owner gets it.
    const older = await registerDevice(w.users.deskA.id, w.gymA.id, "ExponentPushToken[shared-device-01]");
    await db.pushToken.update({ where: { id: older.id }, data: { updatedAt: new Date(Date.now() - 3_600_000) } });
    await registerDevice(w.users.ownerA.id, w.gymA.id, "ExponentPushToken[shared-device-01]");
    await alert(w.users.ownerA.id);
    await alert(w.users.deskA.id);
    const push = new RecordingPush();
    await deliverPendingPushes(db, push);
    expect(push.sent.map((m) => m.to)).toEqual(["ExponentPushToken[shared-device-01]"]);

    await db.platformPlan.update({ where: { code: "TEST" }, data: { featureMobileApp: false } });
    try {
      await alert(w.users.ownerA.id);
      const push2 = new RecordingPush();
      await deliverPendingPushes(db, push2);
      expect(push2.sent).toEqual([]);
    } finally {
      await db.platformPlan.update({ where: { code: "TEST" }, data: { featureMobileApp: true } });
    }
  });
});
