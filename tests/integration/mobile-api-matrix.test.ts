import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, type Endpoint } from "@fitcrm/shared/api/contract";
import * as loginRoute from "@/app/api/mobile/v1/auth/login/route";
import * as selectGymRoute from "@/app/api/mobile/v1/auth/select-gym/route";
import { addDays, fromDateString, localDate } from "@/domain/dates";
import { hashPassword } from "@/server/auth/password";
import { appDb } from "@/server/db/client";
import { createTwoGyms, type World } from "../support/fixtures";
import { callApi, device } from "../support/mobile-api";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/**
 * The mobile API, endpoint by endpoint, driven by the shared contract — so an endpoint added later
 * is covered without anyone remembering to add it here:
 *   - every contract entry has a route that serves it, and every route is in the contract;
 *   - no token / a forged token → 401;
 *   - members can't use staff endpoints and staff can't use member endpoints (403);
 *   - gym B's staff and members get "not found" for gym A's ids, in the path or the body, and
 *     nothing in gym A changes;
 *   - one member gets "not found" for another member's ids in the same gym;
 *   - nothing gym A owns appears in anything gym B can list;
 *   - turning the mobile / member app off in the plan blocks live tokens on the next request.
 */

type Handler = Parameters<typeof callApi>[0];
type RouteModule = Partial<Record<Endpoint["method"], Handler>>;

const ROUTES = import.meta.glob("/src/app/api/mobile/v1/**/route.ts", { eager: true }) as Record<string, RouteModule>;
const NOT_IN_CONTRACT = ["/files/[fileId]", "/progress-photos/[photoId]", "/openapi.json"]; // binary/document responses, tested elsewhere
const routeKey = (path: string) => `/src/app/api/mobile/v1${path.replace(/\{(\w+)\}/g, "[$1]")}/route.ts`;
const ENDPOINTS = Object.entries(api) as [keyof typeof api, Endpoint][];
const handler = (name: keyof typeof api) => {
  const def = api[name] as Endpoint;
  const h = ROUTES[routeKey(def.path)]?.[def.method];
  if (!h) throw new Error(`no handler for ${name}`);
  return h;
};

const TZ = "Asia/Kolkata";
const PASSWORD = "Matrix-Pass-2026";
const today = () => localDate(new Date(), TZ);
let w: World;
const t = { ownerA: "", ownerB: "", memberA: "", memberA2: "", memberB: "" };
// Gym A's records, by the parameter names the contract uses.
const A: Record<string, string> = {};
const A2: Record<string, string> = {}; // belonging to a second member of gym A
let locB = "";

const PLAN_BODY = { title: "P", notes: "", status: "ACTIVE", days: [{ title: "D", exercises: [{ name: "Squat", sets: "3", reps: "5", restSeconds: "", notes: "" }] }] };
const EMPTY_PROGRESS = { bodyFatPct: "", chestCm: "", waistCm: "", hipsCm: "", armCm: "", thighCm: "" };

/** A body that passes validation, so authorization — not a 422 — decides the outcome. */
function sampleBody(name: keyof typeof api): unknown {
  switch (name) {
    case "updateNotificationPreferences":
      return { classReminders: false };
    case "registerPushToken":
      return { token: "ExponentPushToken[matrix-0001-abcdefgh]", platform: "android" };
    case "memberCompleteWorkout":
      return { note: "" };
    case "memberSaveProgress":
      return { recordedOn: today(), weightKg: "80", ...EMPTY_PROGRESS };
    case "memberUpdateProfile":
      return { email: "", phone: "", address: "", emergencyContact: { name: "", phone: "", relation: "" } };
    case "memberRequestDeletion":
      return { reason: "", confirm: true };
    case "staffCheckInLookup":
      return { query: "Alice" };
    case "staffCheckIn":
      return { memberId: A.memberId, locationId: locB, method: "MEMBER_ID" };
    case "staffCreateMember":
      return { firstName: "M", lastName: "X", dateOfBirth: "", healthNotes: "", email: "", phone: "", address: "", emergencyContact: { name: "", phone: "", relation: "" } };
    case "staffSellMembership":
      return { memberId: A.memberId, planId: A.membershipPlanId, startDate: today(), payNow: "none", amount: "", method: "CASH", reference: "" };
    case "staffRecordPayment":
      return { invoiceId: A.invoiceId, amount: "1", method: "CASH", reference: "" };
    case "trainerAttendance":
      return { attended: true };
    case "trainerAddNote":
      return { body: "note" };
    case "trainerCreatePlan":
      return { ...PLAN_BODY, memberId: A.memberId };
    case "trainerUpdatePlan":
      return PLAN_BODY;
    case "trainerAssignPlan":
      return { memberId: A.memberId };
    case "trainerCreateSession":
      return { memberId: A.memberId, startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: "60", focus: "" };
    case "trainerUpdateSession":
      return { status: "CANCELLED" };
    case "createMemberInvite":
      return { channel: "CODE" };
    case "selectGym":
      return { gymSlug: "gym-a" };
    case "changePassword":
      return { currentPassword: "x", newPassword: "Another-Pass-2027", confirmPassword: "Another-Pass-2027" };
    default:
      return undefined;
  }
}

async function call(name: keyof typeof api, token: string | undefined, params: Record<string, string> = {}, body = sampleBody(name)) {
  const def = api[name] as Endpoint;
  if (def.upload) {
    const form = new FormData();
    form.append("takenOn", today());
    form.append("photo", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), "p.jpg");
    return callApi(handler(name), { token, params, form, method: def.method });
  }
  return callApi(handler(name), { token, params, method: def.method, ...(def.body ? { body } : {}) });
}

async function token(email: string, slug: string) {
  const login = await callApi<{ accessToken: string }>(loginRoute.POST, { body: { identifier: email, password: PASSWORD, device: device() } });
  const scoped = await callApi<{ accessToken: string }>(selectGymRoute.POST, { token: login.body.accessToken, body: { gymSlug: slug } });
  if (scoped.status !== 200) throw new Error(`select-gym ${email}: ${scoped.status}`);
  return scoped.body.accessToken;
}

async function gymRowCount(gymId: string) {
  const db = getOwnerDb();
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'gymId' AND table_name NOT IN ('AuditLog')`
  );
  const counts: Record<string, string> = {};
  for (const { table_name } of tables) {
    const [r] = await db.$queryRawUnsafe<{ n: number; latest: Date | null }[]>(`SELECT count(*)::int AS n, max("updatedAt") AS latest FROM "${table_name}" WHERE "gymId" = $1`, gymId).catch(() =>
      db.$queryRawUnsafe<{ n: number; latest: null }[]>(`SELECT count(*)::int AS n, NULL AS latest FROM "${table_name}" WHERE "gymId" = $1`, gymId)
    );
    counts[table_name] = `${r.n}@${r.latest ? new Date(r.latest).toISOString() : "-"}`;
  }
  return counts;
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
    await db.gymCounter.createMany({ data: [{ gymId: g.id, key: "member", value: 100 }, { gymId: g.id, key: "invoice", value: 10 }] });
  }
  // Member-app users: memberA and a second member in gym A, memberB in gym B.
  const account = async (memberId: string, gymId: string, email: string) => {
    const u = await db.user.create({ data: { email, name: email, passwordHash: await hashPassword(PASSWORD) } });
    await db.memberAccount.create({ data: { gymId, memberId, userId: u.id } });
    return u.id;
  };
  const a2 = await db.member.create({ data: { gymId: w.gymA.id, memberNumber: 2, firstName: "Ava", lastName: "Second", checkInCode: "AAAA222222" } });
  const userA = await account(w.memberA.id, w.gymA.id, "member.a@matrix.test");
  const userA2 = await account(a2.id, w.gymA.id, "member.a2@matrix.test");
  await account(w.memberB.id, w.gymB.id, "member.b@matrix.test");

  // Gym A's records for every kind of id the contract takes.
  A.memberId = w.memberA.id;
  const locA = await db.location.create({ data: { gymId: w.gymA.id, name: "A main" } });
  locB = (await db.location.create({ data: { gymId: w.gymB.id, name: "B main" } })).id;
  const room = await db.room.create({ data: { gymId: w.gymA.id, locationId: locA.id, name: "Studio", capacity: 10 } });
  const type = await db.classType.create({ data: { gymId: w.gymA.id, name: "Yoga", color: "#22c55e", durationMinutes: 60, defaultCapacity: 10 } });
  const startsAt = new Date(Date.now() + 2 * 86_400_000);
  A.sessionId = (await db.classSession.create({ data: { gymId: w.gymA.id, classTypeId: type.id, trainerId: w.staff.ownerA.id, roomId: room.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), capacity: 10 } })).id;
  A.membershipPlanId = (await db.membershipPlan.create({ data: { gymId: w.gymA.id, name: "Monthly", type: "MONTHLY", priceMinor: 100, durationDays: 30 } })).id;
  for (const memberId of [w.memberA.id, a2.id]) {
    await db.membership.create({ data: { id: createId(), gymId: w.gymA.id, memberId, planId: A.membershipPlanId, startDate: fromDateString(addDays(today(), -5)), endDate: fromDateString(addDays(today(), 25)), priceMinor: 100 } });
  }
  A.bookingId = (await db.booking.create({ data: { gymId: w.gymA.id, sessionId: A.sessionId, memberId: w.memberA.id, status: "BOOKED" } })).id;
  A.invoiceId = (await db.invoice.create({ data: { gymId: w.gymA.id, number: 1, memberId: w.memberA.id, currency: "INR", subtotalMinor: 100, taxMinor: 0, totalMinor: 100, amountPaidMinor: 0, status: "OPEN", issuedAt: new Date(), dueDate: fromDateString(addDays(today(), 7)) } })).id;
  await db.trainerClient.create({ data: { gymId: w.gymA.id, trainerId: w.staff.ownerA.id, memberId: w.memberA.id } });
  const plan1 = await db.workoutPlan.create({
    data: { gymId: w.gymA.id, trainerId: w.staff.ownerA.id, memberId: w.memberA.id, title: "A plan", status: "ACTIVE", days: { create: [{ position: 0, title: "Day A", exercises: { create: [{ position: 0, name: "Squat" }] } }] } },
    select: { id: true, days: { select: { id: true } } },
  });
  A.planId = plan1.id;
  A.dayId = plan1.days[0].id;
  A.entryId = (await db.progressEntry.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, recordedOn: fromDateString(today()), measurementsEnc: "v1.x.y.z" } })).id;
  A.photoId = (await db.progressPhoto.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, takenOn: fromDateString(today()), storageKey: `${w.gymA.id}/progress-photo/none.jpg`, mimeType: "image/jpeg", sizeBytes: 1, sha256: "x" } })).id;
  A.trainingSessionId = (
    await db.trainingSession.create({ data: { gymId: w.gymA.id, trainerId: w.staff.ownerA.id, memberId: w.memberA.id, startsAt: new Date(Date.now() + 3 * 86_400_000), endsAt: new Date(Date.now() + 3 * 86_400_000 + 3_600_000) } })
  ).id;
  A.notificationId = (await db.notification.create({ data: { gymId: w.gymA.id, recipientUserId: userA, type: "SYSTEM", title: "for A", body: "x", dedupeKey: createId(), pushedAt: new Date() } })).id;

  t.ownerA = await token(w.users.ownerA.email, "gym-a");
  t.ownerB = await token(w.users.ownerB.email, "gym-b");
  t.memberA = await token("member.a@matrix.test", "gym-a");
  t.memberA2 = await token("member.a2@matrix.test", "gym-a");
  t.memberB = await token("member.b@matrix.test", "gym-b");
  A.deviceId = (await db.mobileDeviceSession.findFirstOrThrow({ where: { userId: w.users.ownerA.id }, select: { id: true } })).id;
  void userA2;
}, 120_000);

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("catalog", () => {
  it("every contract endpoint has a route that serves it, and every route is in the contract", () => {
    const missing = ENDPOINTS.filter(([, d]) => !ROUTES[routeKey(d.path)]?.[d.method]).map(([n]) => n);
    expect(missing).toEqual([]);
    const contractKeys = new Set(ENDPOINTS.map(([, d]) => routeKey(d.path)));
    const extra = Object.keys(ROUTES).filter((k) => !contractKeys.has(k) && !NOT_IN_CONTRACT.some((p) => k === `/src/app/api/mobile/v1${p}/route.ts`));
    expect(extra).toEqual([]);
    expect(ENDPOINTS.length).toBeGreaterThanOrEqual(67);
  });
});

describe("authentication", () => {
  const protectedEndpoints = ENDPOINTS.filter(([, d]) => d.auth !== "none");

  it("refuses every protected endpoint without a token, or with a forged one", async () => {
    const forged = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";
    const wrong: string[] = [];
    for (const [name] of protectedEndpoints) {
      const params = Object.fromEntries(Object.keys((api[name] as Endpoint).params?.shape ?? {}).map((k) => [k, A[k] ?? "x"]));
      for (const tok of [undefined, forged]) {
        const r = await call(name, tok, params);
        if (r.status !== 401) wrong.push(`${name} ${tok ? "forged" : "none"}: ${r.status}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("keeps members off staff endpoints and staff off member endpoints", async () => {
    const wrong: string[] = [];
    for (const [name, d] of ENDPOINTS) {
      if (d.auth !== "staff" && d.auth !== "member") continue;
      const params = Object.fromEntries(Object.keys(d.params?.shape ?? {}).map((k) => [k, A[k] ?? "x"]));
      const r = await call(name, d.auth === "staff" ? t.memberA : t.ownerA, params);
      if (r.status !== 403) wrong.push(`${name}: ${r.status}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("cross-gym and cross-member access", () => {
  it("gym B's staff and members get 'not found' for gym A's ids, and gym A is unchanged", async () => {
    const before = await gymRowCount(w.gymA.id);
    const wrong: string[] = [];
    const BODY_ID_ENDPOINTS = new Set(["staffCheckIn", "staffSellMembership", "staffRecordPayment", "trainerCreatePlan", "trainerCreateSession"]);
    for (const [name, d] of ENDPOINTS) {
      const keys = Object.keys(d.params?.shape ?? {});
      if (!keys.length && !BODY_ID_ENDPOINTS.has(name)) continue;
      const actor = d.auth === "member" ? t.memberB : t.ownerB;
      if (d.auth === "none") continue;
      const r = await call(name, actor, Object.fromEntries(keys.map((k) => [k, A[k]])));
      if (r.status !== 404 && r.status !== 403) wrong.push(`${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    }
    expect(wrong).toEqual([]);
    expect(await gymRowCount(w.gymA.id)).toEqual(before);
  });

  it("a member gets 'not found' for another member's records in the same gym", async () => {
    const before = await gymRowCount(w.gymA.id);
    const wrong: string[] = [];
    for (const [name, d] of ENDPOINTS) {
      const keys = Object.keys(d.params?.shape ?? {});
      if (d.auth === "staff" || d.auth === "none" || !keys.length || name === "memberBook") continue;
      const r = await call(name, t.memberA2, Object.fromEntries(keys.map((k) => [k, A[k]])));
      if (r.status !== 404) wrong.push(`${name}: ${r.status}`);
    }
    expect(wrong).toEqual([]);
    expect(await gymRowCount(w.gymA.id)).toEqual(before);
    void A2;
  });

  it("nothing gym A owns shows up in anything gym B can list", async () => {
    const secrets = [w.gymA.id, w.memberA.id, A.sessionId, A.bookingId, A.invoiceId, A.planId, A.entryId, A.photoId, A.trainingSessionId, A.notificationId, "Alice", "Anand", "Gym A"];
    const leaks: string[] = [];
    for (const [name, d] of ENDPOINTS) {
      if (d.method !== "GET" || d.params || d.auth === "none") continue;
      const actor = d.auth === "member" ? t.memberB : d.auth === "user" ? t.ownerB : t.ownerB;
      const r = await call(name, actor);
      if (r.status !== 200) {
        leaks.push(`${name}: status ${r.status}`);
        continue;
      }
      const text = JSON.stringify(r.body);
      for (const s of secrets) if (text.includes(s)) leaks.push(`${name} contains ${s}`);
    }
    // gym B's members also list gym-level things (announcements, inbox, gym).
    for (const name of ["notifications", "announcements", "gym", "notificationPreferences"] as const) {
      const text = JSON.stringify((await call(name, t.memberB)).body);
      for (const s of secrets) if (text.includes(s)) leaks.push(`${name} (member) contains ${s}`);
    }
    expect(leaks).toEqual([]);
  });

  it("a user can't sign out someone else's device", async () => {
    const r = await call("revokeDevice", t.ownerB, { deviceId: A.deviceId });
    expect(r.status).toBe(404);
    expect((await getOwnerDb().mobileDeviceSession.findUniqueOrThrow({ where: { id: A.deviceId } })).revokedAt).toBeNull();
  });
});

describe("plan feature flags", () => {
  it("turning the staff or member app off blocks live tokens on their next request", async () => {
    const db = getOwnerDb();
    await db.platformPlan.update({ where: { code: "TEST" }, data: { featureMobileApp: false } });
    try {
      const wrong: string[] = [];
      for (const [name, d] of ENDPOINTS) {
        if (d.auth !== "staff" || d.method !== "GET" || d.params) continue;
        const r = await call(name, t.ownerA);
        if (r.status !== 402) wrong.push(`${name}: ${r.status}`);
      }
      expect(wrong).toEqual([]);
      expect((await call("memberCard", t.memberA)).status).toBe(200);
    } finally {
      await db.platformPlan.update({ where: { code: "TEST" }, data: { featureMobileApp: true } });
    }
    await db.platformPlan.update({ where: { code: "TEST" }, data: { featureMemberApp: false } });
    try {
      const wrong: string[] = [];
      for (const [name, d] of ENDPOINTS) {
        if (d.auth !== "member" || d.method !== "GET" || d.params) continue;
        const r = await call(name, t.memberA);
        if (r.status !== 402) wrong.push(`${name}: ${r.status}`);
      }
      expect(wrong).toEqual([]);
    } finally {
      await db.platformPlan.update({ where: { code: "TEST" }, data: { featureMemberApp: true } });
    }
  });
});
