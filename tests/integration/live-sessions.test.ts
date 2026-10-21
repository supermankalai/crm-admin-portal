import { createHash } from "node:crypto";
import { jwtVerify } from "jose";
import { AccessToken } from "livekit-server-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as loginRoute from "@/app/api/mobile/v1/auth/login/route";
import * as selectGymRoute from "@/app/api/mobile/v1/auth/select-gym/route";
import * as liveTokenRoute from "@/app/api/mobile/v1/live/[kind]/[sessionId]/token/route";
import { hashPassword } from "@/server/auth/password";
import { liveRoomName } from "@/domain/live";
import { generateGymNotifications } from "@/server/notifications";
import type { PushMessage, PushProvider, PushTicket } from "@/server/push/provider";
import { deliverPendingPushes } from "@/server/push/deliver";
import { listInbox } from "@/server/services/app-inbox";
import type { GymAuth } from "@/server/mobile/context";
import { appDb } from "@/server/db/client";
import { AppError, FeatureNotInPlanError, ForbiddenError, NotFoundError, UnauthenticatedError } from "@/server/errors";
import { addDays, localDate } from "@/domain/dates";
import { weekStart } from "@/domain/classes";
import { cancelSession, createSessions, updateSession } from "@/server/services/classes/sessions";
import { liveAttendance, presenceLabel } from "@/server/services/live/attendance";
import { mySchedule } from "@/server/services/staff";
import { closeEndedLiveRooms } from "@/server/services/live/close-ended";
import { liveKitConfig } from "@/server/services/live/config";
import { joinAsMember, joinAsStaff, moderateLive } from "@/server/services/live/join";
import { setLiveRoomAdminForTests, type LiveRoomAdmin } from "@/server/services/live/rooms";
import { handleLiveWebhook } from "@/server/services/live/webhook";
import { bookSession, closeSession } from "@/server/services/pt/sessions";
import { resolveMemberContext, type MemberContext } from "@/server/tenant/member";
import { resolveTenant } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { createTwoGyms, type World } from "../support/fixtures";
import { callApi, device } from "../support/mobile-api";
import { asApp, disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/** Live sessions: who may join which room with what rights, the webhook's attendance, closing rooms. */

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
// tests/support/load-env.ts sets a throwaway key: tokens are signed and checked locally.
const config = liveKitConfig()!;

class FakeRooms implements LiveRoomAdmin {
  open = new Set<string>();
  deleted: string[] = [];
  /** "room|identity" of who is connected right now. */
  present = new Set<string>();
  muted: string[] = [];
  removed: string[] = [];
  async listRooms() {
    return [...this.open];
  }
  async deleteRoom(name: string) {
    this.deleted.push(name);
    this.open.delete(name);
  }
  async muteMicrophone(room: string, identity: string) {
    if (!this.present.has(`${room}|${identity}`)) return false;
    this.muted.push(identity);
    return true;
  }
  async removeParticipant(room: string, identity: string) {
    if (!this.present.delete(`${room}|${identity}`)) return false;
    this.removed.push(identity);
    return true;
  }
}
const rooms = new FakeRooms();

let w: World;
let trainer: TenantContext;
let otherTrainer: TenantContext;
let ownerA: TenantContext;
let deskA: TenantContext;
let ownerB: TenantContext;
let alice: MemberContext;
let mo: MemberContext;
const ids = { trainer: "", otherTrainer: "", mo: "", room: "", classType: "", onlineClass: "", hybridClass: "", inPersonClass: "", futureClass: "", onlinePt: "", inPersonPt: "", moPt: "" };

const minutes = (n: number) => new Date(Date.now() + n * 60_000);

async function decode(token: string) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(config.apiSecret), { issuer: config.apiKey });
  return payload as { sub: string; name: string; exp: number; video: Record<string, unknown>; attributes: Record<string, string>; roomConfig?: Record<string, unknown> };
}

async function expectError(p: Promise<unknown>, type: new (...a: never[]) => Error, code?: string) {
  const error = await p.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(type);
  if (code) expect((error as AppError).code).toBe(code);
}

async function signedWebhook(event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  const at = new AccessToken(config.apiKey, config.apiSecret);
  at.sha256 = createHash("sha256").update(body).digest("base64");
  return { body, auth: await at.toJwt() };
}

async function webhook(event: string, room: string, identity: string | null, atSeconds: number) {
  const w = await signedWebhook({ id: `EV_${Math.random()}`, event, room: { name: room }, ...(identity ? { participant: { identity } } : {}), createdAt: String(atSeconds) });
  return handleLiveWebhook(w.body, w.auth);
}

beforeAll(async () => {
  setLiveRoomAdminForTests(rooms);
  await truncateAll();
  w = await createTwoGyms();
  const db = getOwnerDb();
  const plan = await db.platformPlan.update({ where: { code: "TEST" }, data: { maxMembers: 100, maxStaff: 20, featureLiveSessions: true } });
  for (const g of [w.gymA, w.gymB]) {
    await db.gym.update({ where: { id: g.id }, data: { status: "ACTIVE" } });
    await db.gymSubscription.create({ data: { gymId: g.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  }
  const staff = async (email: string) => {
    const u = await db.user.create({ data: { email, name: email.split("@")[0], passwordHash: "$argon2id$x" } });
    const s = await db.staffMember.create({ data: { gymId: w.gymA.id, userId: u.id, role: "TRAINER" } });
    return { staffId: s.id, u };
  };
  const t1 = await staff("tara@live.test");
  const t2 = await staff("tom@live.test");
  ids.trainer = t1.staffId;
  ids.otherTrainer = t2.staffId;

  const aliceUser = await db.user.create({ data: { email: "alice.app@live.test", name: "Alice", passwordHash: "$argon2id$x" } });
  await db.memberAccount.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, userId: aliceUser.id } });
  ids.mo = (await db.member.create({ data: { gymId: w.gymA.id, memberNumber: 2, firstName: "Mo", lastName: "Mehta", checkInCode: "MOMO000002" } })).id;
  const moUser = await db.user.create({ data: { email: "mo.app@live.test", name: "Mo", passwordHash: "$argon2id$x" } });
  await db.memberAccount.create({ data: { gymId: w.gymA.id, memberId: ids.mo, userId: moUser.id } });

  const location = await db.location.create({ data: { gymId: w.gymA.id, name: "Main" } });
  ids.room = (await db.room.create({ data: { gymId: w.gymA.id, locationId: location.id, name: "Studio", capacity: 20 } })).id;
  ids.classType = (await db.classType.create({ data: { gymId: w.gymA.id, name: "Yoga", color: "#22aa88", durationMinutes: 60, defaultCapacity: 12 } })).id;
  const cls = async (deliveryMode: "IN_PERSON" | "ONLINE" | "HYBRID", startsIn: number) =>
    (
      await db.classSession.create({
        data: { gymId: w.gymA.id, classTypeId: ids.classType, trainerId: ids.trainer, roomId: deliveryMode === "ONLINE" ? null : ids.room, startsAt: minutes(startsIn), endsAt: minutes(startsIn + 60), capacity: 12, deliveryMode },
      })
    ).id;
  ids.onlineClass = await cls("ONLINE", 5);
  ids.hybridClass = await cls("HYBRID", -20);
  ids.inPersonClass = await cls("IN_PERSON", 5);
  ids.futureClass = await cls("ONLINE", 120);
  for (const sessionId of [ids.onlineClass, ids.hybridClass, ids.inPersonClass, ids.futureClass]) {
    await db.booking.create({ data: { gymId: w.gymA.id, sessionId, memberId: w.memberA.id, status: "BOOKED" } });
  }
  await db.booking.create({ data: { gymId: w.gymA.id, sessionId: ids.onlineClass, memberId: ids.mo, status: "WAITLISTED", waitlistPosition: 1 } });

  await db.trainerClient.create({ data: { gymId: w.gymA.id, trainerId: ids.trainer, memberId: w.memberA.id } });
  const pt = async (memberId: string, deliveryMode: "IN_PERSON" | "ONLINE") =>
    (await db.trainingSession.create({ data: { gymId: w.gymA.id, trainerId: ids.trainer, memberId, startsAt: minutes(2), endsAt: minutes(62), deliveryMode } })).id;
  ids.onlinePt = await pt(w.memberA.id, "ONLINE");
  ids.inPersonPt = await pt(w.memberA.id, "IN_PERSON");
  ids.moPt = await pt(ids.mo, "ONLINE");

  const u = (x: { id: string; name: string; email: string | null }) => ({ id: x.id, name: x.name, email: x.email ?? "", isSuperAdmin: false });
  trainer = (await resolveTenant(u(t1.u), "gym-a"))!;
  otherTrainer = (await resolveTenant(u(t2.u), "gym-a"))!;
  ownerA = (await resolveTenant(u(w.users.ownerA), "gym-a"))!;
  deskA = (await resolveTenant(u(w.users.deskA), "gym-a"))!;
  ownerB = (await resolveTenant(u(w.users.ownerB), "gym-b"))!;
  alice = (await resolveMemberContext(u(aliceUser), { slug: "gym-a" }))!;
  mo = (await resolveMemberContext(u(moUser), { slug: "gym-a" }))!;
});

beforeEach(async () => {
  // Every join is rate limited per user; start each test with a clean slate.
  await getOwnerDb().rateLimitBucket.deleteMany({});
});

afterAll(async () => {
  setLiveRoomAdminForTests(undefined);
  await appDb.$disconnect();
  await disconnectAll();
});

describe("the class trainer", () => {
  it("joins as host: this room only, camera, mic and screen share, can moderate, sized to the class", async () => {
    const join = await joinAsStaff(trainer, "class", ids.onlineClass);
    expect(join.url).toBe(config.url);
    expect(join.roomName).toBe(liveRoomName(w.gymA.id, "class", ids.onlineClass));
    expect(join.role).toBe("host");
    const t = await decode(join.token);
    expect(t.sub).toBe(`s_${ids.trainer}`);
    expect(t.name).toBe("tara");
    expect(t.attributes).toEqual({ role: "host" });
    expect(t.video).toMatchObject({ room: join.roomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false, roomAdmin: true });
    expect(t.video.canPublishSources).toEqual(["camera", "microphone", "screen_share", "screen_share_audio"]);
    expect(t.roomConfig).toMatchObject({ name: join.roomName, maxParticipants: 14 });
    // Until 15 minutes after the end (the class ends in 65 minutes).
    expect(t.exp * 1000 - Date.now()).toBeGreaterThan(79 * 60_000);
    expect(t.exp * 1000 - Date.now()).toBeLessThanOrEqual(80 * 60_000 + 1000);
    expect(JSON.stringify(t)).not.toContain(config.apiSecret);
  });

  it("can join a hybrid class already under way", async () => {
    expect((await joinAsStaff(trainer, "class", ids.hybridClass)).role).toBe("host");
  });

  it("can't join before the window opens, or an in-person class", async () => {
    await expectError(joinAsStaff(trainer, "class", ids.futureClass), AppError, "live_too_early");
    await expectError(joinAsStaff(trainer, "class", ids.inPersonClass), AppError, "live_in_person");
  });
});

describe("nobody else on the staff", () => {
  it("can join a class or PT call: not managers or owners, front desk, or another trainer", async () => {
    for (const ctx of [ownerA, deskA, otherTrainer]) {
      await expectError(joinAsStaff(ctx, "class", ids.onlineClass), ForbiddenError);
      await expectError(joinAsStaff(ctx, "pt", ids.onlinePt), ForbiddenError);
    }
  });

  it("and another gym's staff don't even find the session", async () => {
    await expectError(joinAsStaff(ownerB, "class", ids.onlineClass), NotFoundError);
    await expectError(joinAsStaff(ownerB, "pt", ids.onlinePt), NotFoundError);
  });
});

describe("members", () => {
  it("join a class they're booked in, by first name and initial, with camera and mic only", async () => {
    const join = await joinAsMember(alice, "class", ids.onlineClass);
    expect(join.role).toBe("member");
    const t = await decode(join.token);
    expect(t.sub).toBe(`m_${w.memberA.id}`);
    expect(t.name).toBe("Alice A.");
    expect(t.video).toMatchObject({ room: join.roomName, canPublish: true, roomAdmin: false });
    expect(t.video.canPublishSources).toEqual(["camera", "microphone"]);
  });

  it("can't join from the waitlist, or without a booking", async () => {
    await expectError(joinAsMember(mo, "class", ids.onlineClass), ForbiddenError);
    await expectError(joinAsMember(mo, "class", ids.hybridClass), ForbiddenError);
  });

  it("join their own PT call by full name, and never anyone else's", async () => {
    const join = await joinAsMember(alice, "pt", ids.onlinePt);
    const t = await decode(join.token);
    expect(t.name).toBe("Alice Anand");
    expect(t.roomConfig).toMatchObject({ maxParticipants: 3 });
    await expectError(joinAsMember(alice, "pt", ids.moPt), NotFoundError);
    await expectError(joinAsMember(mo, "pt", ids.onlinePt), NotFoundError);
  });

  it("the PT trainer joins as coach; an in-person session has no call", async () => {
    expect((await joinAsStaff(trainer, "pt", ids.onlinePt)).role).toBe("coach");
    await expectError(joinAsStaff(trainer, "pt", ids.inPersonPt), AppError, "live_in_person");
    await expectError(joinAsMember(alice, "pt", ids.inPersonPt), AppError, "live_in_person");
  });
});

describe("the plan and the rate limit", () => {
  it("block joins when the plan doesn't include live sessions", async () => {
    const db = getOwnerDb();
    await db.platformPlan.update({ where: { code: "TEST" }, data: { featureLiveSessions: false } });
    try {
      const u = { id: trainer.user.id, name: trainer.user.name, email: trainer.user.email, isSuperAdmin: false };
      const fresh = (await resolveTenant(u, "gym-a"))!;
      await expectError(joinAsStaff(fresh, "class", ids.onlineClass), FeatureNotInPlanError);
    } finally {
      await db.platformPlan.update({ where: { code: "TEST" }, data: { featureLiveSessions: true } });
    }
  });

  it("limit how often one person asks for tokens", async () => {
    for (let i = 0; i < 30; i++) await joinAsStaff(trainer, "class", ids.onlineClass);
    await expectError(joinAsStaff(trainer, "class", ids.onlineClass), Error);
  });
});

describe("the webhook", () => {
  const room = () => liveRoomName(w.gymA.id, "class", ids.hybridClass);
  const t0 = Math.floor(Date.now() / 1000);

  it("records who joined and for how long", async () => {
    expect(await webhook("participant_joined", room(), `m_${w.memberA.id}`, t0)).toEqual({ recorded: true });
    expect(await webhook("participant_joined", room(), `m_${w.memberA.id}`, t0 + 5)).toEqual({ recorded: true }); // repeated: harmless
    expect(await webhook("participant_left", room(), `m_${w.memberA.id}`, t0 + 600)).toEqual({ recorded: true });
    expect(await webhook("participant_joined", room(), `s_${ids.trainer}`, t0)).toEqual({ recorded: true });
    expect(await webhook("room_finished", room(), null, t0 + 900)).toEqual({ recorded: true });
    const rows = await getOwnerDb().liveAttendance.findMany({ where: { sessionId: ids.hybridClass }, orderBy: { seconds: "asc" } });
    expect(rows.map((r) => [r.memberId ?? r.staffId, r.seconds, r.connectedAt])).toEqual([
      [w.memberA.id, 600, null],
      [ids.trainer, 900, null],
    ]);
  });

  it("ignores unsigned or altered events", async () => {
    const good = await signedWebhook({ event: "participant_joined", room: { name: room() }, participant: { identity: `m_${w.memberA.id}` } });
    await expectError(handleLiveWebhook(good.body, null), UnauthenticatedError);
    await expectError(handleLiveWebhook(good.body.replace("joined", "left"), good.auth), UnauthenticatedError);
    const forged = new AccessToken(config.apiKey, "a-different-secret-entirely-000");
    forged.sha256 = createHash("sha256").update(good.body).digest("base64");
    await expectError(handleLiveWebhook(good.body, await forged.toJwt()), UnauthenticatedError);
  });

  it("records nothing for rooms or people that don't match", async () => {
    // Gym B's room name with gym A's session, a member of gym B, an in-person class, another app's room.
    expect(await webhook("participant_joined", liveRoomName(w.gymB.id, "class", ids.hybridClass), `m_${w.memberB.id}`, t0)).toEqual({ recorded: false });
    expect(await webhook("participant_joined", room(), `m_${w.memberB.id}`, t0)).toEqual({ recorded: false });
    expect(await webhook("participant_joined", liveRoomName(w.gymA.id, "class", ids.inPersonClass), `m_${w.memberA.id}`, t0)).toEqual({ recorded: false });
    expect(await webhook("participant_joined", "standup", "someone", t0)).toEqual({ recorded: false });
  });
});

describe("attendance rows", () => {
  it("are read by the gym's staff and the member themselves, and written only through the webhook", async () => {
    const asStaff = await asApp({ userId: ownerA.user.id, gymId: w.gymA.id }, (tx) => tx.liveAttendance.count());
    expect(asStaff).toBe(2);
    expect(await asApp({ userId: ownerB.user.id, gymId: w.gymB.id }, (tx) => tx.liveAttendance.count())).toBe(0);
    expect(await asApp({ userId: alice.user.id, gymId: w.gymA.id, memberId: w.memberA.id }, (tx) => tx.liveAttendance.count())).toBe(1);
    expect(await asApp({ userId: mo.user.id, gymId: w.gymA.id, memberId: ids.mo }, (tx) => tx.liveAttendance.count())).toBe(0);
    const insert = asApp({ userId: ownerA.user.id, gymId: w.gymA.id }, (tx) =>
      tx.liveAttendance.create({ data: { gymId: w.gymA.id, kind: "CLASS", sessionId: ids.onlineClass, memberId: ids.mo, firstJoinedAt: new Date() } })
    );
    await expect(insert).rejects.toThrow();
  });
});

describe("the mobile endpoint", () => {
  async function appToken(email: string) {
    await getOwnerDb().user.update({ where: { email }, data: { passwordHash: await hashPassword("Live-Pass-2026") } });
    const login = await callApi<{ accessToken: string }>(loginRoute.POST, { body: { identifier: email, password: "Live-Pass-2026", device: device() } });
    const scoped = await callApi<{ accessToken: string }>(selectGymRoute.POST, { token: login.body.accessToken, body: { gymSlug: "gym-a" } });
    return scoped.body.accessToken;
  }

  it("gives the trainer and the booked member their own tokens, and tells others why not", async () => {
    const params = { kind: "class", sessionId: ids.onlineClass };
    const asTrainer = await callApi<{ role: string; token: string; url: string; expiresAt: string; session: { title: string; deliveryMode: string } }>(liveTokenRoute.POST, { method: "POST", token: await appToken("tara@live.test"), params });
    expect(asTrainer.status).toBe(200);
    expect(asTrainer.body).toMatchObject({ role: "host", url: config.url, session: { title: "Yoga", deliveryMode: "ONLINE" } });
    expect(new Date(asTrainer.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(asTrainer.headers.get("cache-control")).toBe("no-store");

    const asMember = await callApi<{ role: string }>(liveTokenRoute.POST, { method: "POST", token: await appToken("alice.app@live.test"), params });
    expect(asMember.status).toBe(200);
    expect(asMember.body.role).toBe("member");

    const waitlisted = await callApi(liveTokenRoute.POST, { method: "POST", token: await appToken("mo.app@live.test"), params });
    expect(waitlisted.status).toBe(403);
    expect(waitlisted.body.error?.message).toMatch(/waitlist/);

    const early = await callApi(liveTokenRoute.POST, { method: "POST", token: await appToken("tara@live.test"), params: { kind: "class", sessionId: ids.futureClass } });
    expect(early.status).toBe(409);
    expect(early.body.error?.code).toBe("live_too_early");

    const bad = await callApi(liveTokenRoute.POST, { method: "POST", token: await appToken("tara@live.test"), params: { kind: "video", sessionId: ids.onlineClass } });
    expect(bad.status).toBe(422);
  });
});

describe("scheduling online classes and booking online PT", () => {
  const inDays = (n: number) => addDays(localDate(new Date(), ownerA.gym.timezone), n);
  const base = () => ({ classTypeId: ids.classType, trainerId: ids.trainer, date: inDays(3), durationMinutes: 60, repeatWeeks: 1 });

  it("an online class has no room and no room-sized cap; a hybrid one keeps its room", async () => {
    await createSessions(ownerA, { ...base(), deliveryMode: "ONLINE", roomId: null, startTime: "09:00", capacity: 40 }, meta);
    await createSessions(ownerA, { ...base(), deliveryMode: "HYBRID", roomId: ids.room, startTime: "07:00", capacity: 30 }, meta);
    const rows = await getOwnerDb().classSession.findMany({ where: { gymId: w.gymA.id, capacity: { in: [30, 40] } }, select: { deliveryMode: true, roomId: true, capacity: true }, orderBy: { capacity: "asc" } });
    expect(rows).toEqual([
      { deliveryMode: "HYBRID", roomId: ids.room, capacity: 30 },
      { deliveryMode: "ONLINE", roomId: null, capacity: 40 },
    ]);
    // In the room only, the room's size still caps it (the studio holds 20).
    await expectError(createSessions(ownerA, { ...base(), deliveryMode: "IN_PERSON", roomId: ids.room, startTime: "12:00", capacity: 30 }, meta), AppError, "validation");
  });

  it("editing an online class leaves it without a room", async () => {
    const online = await getOwnerDb().classSession.findFirstOrThrow({ where: { gymId: w.gymA.id, capacity: 40 }, select: { id: true } });
    await updateSession(ownerA, { sessionId: online.id, trainerId: ids.trainer, roomId: ids.room, capacity: 35 }, meta);
    expect(await getOwnerDb().classSession.findUniqueOrThrow({ where: { id: online.id }, select: { roomId: true, capacity: true } })).toEqual({ roomId: null, capacity: 35 });
  });

  it("a trainer books an online PT session with their client", async () => {
    const r = await bookSession(trainer, { memberId: w.memberA.id, startsAt: new Date(Date.now() + 4 * 86_400_000), durationMinutes: 45, focus: "Mobility", deliveryMode: "ONLINE" }, meta);
    expect(await getOwnerDb().trainingSession.findUniqueOrThrow({ where: { id: r.id }, select: { deliveryMode: true } })).toEqual({ deliveryMode: "ONLINE" });
  });

  it("neither is possible when the plan doesn't include live sessions", async () => {
    const db = getOwnerDb();
    await db.platformPlan.update({ where: { code: "TEST" }, data: { featureLiveSessions: false } });
    try {
      const owner = (await resolveTenant({ id: ownerA.user.id, name: ownerA.user.name, email: ownerA.user.email, isSuperAdmin: false }, "gym-a"))!;
      const coach = (await resolveTenant({ id: trainer.user.id, name: trainer.user.name, email: trainer.user.email, isSuperAdmin: false }, "gym-a"))!;
      await expectError(createSessions(owner, { ...base(), deliveryMode: "ONLINE", roomId: null, startTime: "15:00", capacity: 10 }, meta), FeatureNotInPlanError);
      await expectError(bookSession(coach, { memberId: w.memberA.id, startsAt: new Date(Date.now() + 5 * 86_400_000), durationMinutes: 45, focus: null, deliveryMode: "ONLINE" }, meta), FeatureNotInPlanError);
      // In person still works.
      await createSessions(owner, { ...base(), deliveryMode: "IN_PERSON", roomId: ids.room, startTime: "15:00", capacity: 10 }, meta);
    } finally {
      await db.platformPlan.update({ where: { code: "TEST" }, data: { featureLiveSessions: true } });
    }
  });
});

describe("the class host", () => {
  const room = () => liveRoomName(w.gymA.id, "class", ids.onlineClass);

  it("mutes and removes people in the call; someone already gone is reported", async () => {
    rooms.present = new Set([`${room()}|m_${w.memberA.id}`]);
    expect(await moderateLive(trainer, ids.onlineClass, `m_${w.memberA.id}`, "mute")).toEqual({ done: true });
    expect(await moderateLive(trainer, ids.onlineClass, `m_${w.memberA.id}`, "remove")).toEqual({ done: true });
    expect(await moderateLive(trainer, ids.onlineClass, `m_${w.memberA.id}`, "remove")).toEqual({ done: false });
    expect(rooms.muted).toEqual([`m_${w.memberA.id}`]);
    expect(rooms.removed).toEqual([`m_${w.memberA.id}`]);
  });

  it("is the class's trainer only, never for PT calls, and not on themselves", async () => {
    for (const ctx of [ownerA, otherTrainer, deskA]) await expectError(moderateLive(ctx, ids.onlineClass, `m_${w.memberA.id}`, "mute"), ForbiddenError);
    await expectError(moderateLive(ownerB, ids.onlineClass, `m_${w.memberA.id}`, "mute"), NotFoundError);
    await expectError(moderateLive(trainer, ids.onlinePt, `m_${w.memberA.id}`, "mute"), NotFoundError);
    await expectError(moderateLive(trainer, ids.onlineClass, `s_${ids.trainer}`, "remove"), AppError, "live_self");
    await expectError(moderateLive(trainer, ids.onlineClass, "someone", "remove"), NotFoundError);
  });
});

describe("what the web pages show", () => {
  it("who joined online and for how long", async () => {
    const presence = await liveAttendance(ownerA, "class", [ids.hybridClass]);
    const alice = presence.get(ids.hybridClass)?.get(w.memberA.id);
    expect(alice).toEqual({ seconds: 600, connected: false });
    expect(presenceLabel(alice!)).toBe("joined online · 10 min");
    expect(presenceLabel({ seconds: 3900, connected: true })).toBe("online now · 1 h 5 min");
    expect((await liveAttendance(ownerB, "class", [ids.hybridClass])).size).toBe(0);
  });

  it("the trainer's schedule includes their PT sessions and how each is delivered", async () => {
    const { classes, pts } = await mySchedule(trainer, weekStart(localDate(new Date(), trainer.gym.timezone)));
    expect(classes.find((c) => c.id === ids.onlineClass)?.deliveryMode).toBe("ONLINE");
    expect(pts.find((p) => p.id === ids.onlinePt)?.deliveryMode).toBe("ONLINE");
  });
});

describe("\"starts soon\" alerts", () => {
  class RecordingPush implements PushProvider {
    sent: PushMessage[] = [];
    async send(messages: PushMessage[]): Promise<PushTicket[]> {
      this.sent.push(...messages);
      return messages.map((_, i) => ({ status: "ok" as const, id: `t${this.sent.length}-${i}` }));
    }
    async receipts() {
      return {};
    }
  }

  it("go to booked members, the PT client and the trainer when the call opens, once", async () => {
    const db = getOwnerDb();
    await db.$transaction((tx) => generateGymNotifications(tx, w.gymA.id));
    await db.$transaction((tx) => generateGymNotifications(tx, w.gymA.id));
    const rows = await db.notification.findMany({ where: { gymId: w.gymA.id, type: { in: ["LIVE_CLASS_STARTING", "LIVE_PT_STARTING"] } }, select: { recipientUserId: true, type: true, entityId: true } });
    const got = rows.map((r) => `${r.recipientUserId === alice.user.id ? "alice" : r.recipientUserId === mo.user.id ? "mo" : r.recipientUserId === trainer.user.id ? "trainer" : "other"}:${r.type}:${r.entityId}`).sort();
    expect(got).toEqual(
      [
        // The online class (starts in 5 minutes): Alice is booked, Mo is only on the waitlist.
        `alice:LIVE_CLASS_STARTING:${ids.onlineClass}`,
        `trainer:LIVE_CLASS_STARTING:${ids.onlineClass}`,
        // Online PT sessions starting in 2 minutes (the in-person one gets nothing).
        `alice:LIVE_PT_STARTING:${ids.onlinePt}`,
        `trainer:LIVE_PT_STARTING:${ids.onlinePt}`,
        `mo:LIVE_PT_STARTING:${ids.moPt}`,
        `trainer:LIVE_PT_STARTING:${ids.moPt}`,
      ].sort()
    );
  });

  it("open the call from the inbox and from the push alert", async () => {
    const auth = { kind: "member", member: alice, user: alice.user, sessionId: "", sessionVersion: 0 } as unknown as GymAuth;
    const inbox = await listInbox(auth, { limit: 20 });
    const live = inbox.items.filter((i) => i.live).map((i) => i.live);
    expect(live).toEqual(expect.arrayContaining([{ kind: "class", sessionId: ids.onlineClass }, { kind: "pt", sessionId: ids.onlinePt }]));

    const db = getOwnerDb();
    const device = await db.mobileDeviceSession.findFirstOrThrow({ where: { userId: alice.user.id }, select: { id: true } });
    await db.pushToken.create({ data: { gymId: w.gymA.id, userId: alice.user.id, deviceSessionId: device.id, token: "ExponentPushToken[live-0001-abcdefgh]", platform: "android" } });
    const push = new RecordingPush();
    await deliverPendingPushes(db, push);
    // Her other alerts (PT reminders and so on) carry no call.
    const mine = push.sent.filter((m) => m.to === "ExponentPushToken[live-0001-abcdefgh]" && m.data.live);
    expect(push.sent.filter((m) => m.data.live && !/^(class|pt):/.test(m.data.live))).toEqual([]);
    expect(mine.map((m) => m.data.live).sort()).toEqual([`class:${ids.onlineClass}`, `pt:${ids.onlinePt}`].sort());
    // Lock screens stay generic: no class name, trainer or time.
    for (const m of mine) {
      expect(m.body).toMatch(/about to start\. Tap to join\./);
      expect(m.body).not.toMatch(/Yoga|tara/);
    }
  });
});

describe("closing rooms", () => {
  it("cancelling an online class or PT session closes its room; in-person ones call nothing", async () => {
    rooms.deleted = [];
    await cancelSession(trainer, ids.inPersonClass, "test", meta);
    expect(rooms.deleted).toEqual([]);
    await cancelSession(trainer, ids.futureClass, "test", meta);
    await closeSession(ownerA, ids.moPt, "CANCELLED", meta);
    expect(rooms.deleted).toEqual([liveRoomName(w.gymA.id, "class", ids.futureClass), liveRoomName(w.gymA.id, "pt", ids.moPt)]);
    await expectError(joinAsStaff(trainer, "class", ids.futureClass), AppError, "live_cancelled");
  });

  it("the job closes this app's rooms whose session is over, and leaves others alone", async () => {
    const db = getOwnerDb();
    const live = liveRoomName(w.gymA.id, "class", ids.onlineClass);
    const cancelled = liveRoomName(w.gymA.id, "pt", ids.moPt);
    const ended = liveRoomName(w.gymA.id, "pt", ids.onlinePt);
    const wrongGym = liveRoomName(w.gymB.id, "class", ids.onlineClass);
    rooms.open = new Set([live, cancelled, ended, wrongGym, "standup", "live-check-1234"]);
    rooms.deleted = [];
    // The online PT session ended over 15 minutes ago.
    const result = await closeEndedLiveRooms(db, minutes(62 + 16));
    // At that time the online class (ends in 65 minutes) is still within its window.
    expect(rooms.deleted.sort()).toEqual([cancelled, ended, wrongGym].sort());
    expect(result).toEqual({ open: 1, closed: 3 });
    expect([...rooms.open].sort()).toEqual([live, "live-check-1234", "standup"].sort());
  });
});
