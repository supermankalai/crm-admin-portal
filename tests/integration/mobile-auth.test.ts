import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as inviteLookupRoute from "@/app/api/mobile/v1/auth/invite/lookup/route";
import * as inviteRedeemRoute from "@/app/api/mobile/v1/auth/invite/redeem/route";
import * as loginRoute from "@/app/api/mobile/v1/auth/login/route";
import * as logoutRoute from "@/app/api/mobile/v1/auth/logout/route";
import * as otpRequestRoute from "@/app/api/mobile/v1/auth/otp/request/route";
import * as otpVerifyRoute from "@/app/api/mobile/v1/auth/otp/verify/route";
import * as refreshRoute from "@/app/api/mobile/v1/auth/refresh/route";
import * as selectGymRoute from "@/app/api/mobile/v1/auth/select-gym/route";
import * as gymRoute from "@/app/api/mobile/v1/gym/route";
import * as deviceRoute from "@/app/api/mobile/v1/me/devices/[deviceId]/route";
import * as devicesRoute from "@/app/api/mobile/v1/me/devices/route";
import * as passwordRoute from "@/app/api/mobile/v1/me/password/route";
import * as meRoute from "@/app/api/mobile/v1/me/route";
import * as openapiRoute from "@/app/api/mobile/v1/openapi.json/route";
import * as inviteRoute from "@/app/api/mobile/v1/staff/members/[memberId]/app-invite/route";
import { hashPassword } from "@/server/auth/password";
import { encryptField, phoneBlindIndex } from "@/server/crypto";
import { appDb } from "@/server/db/client";
import { getEmailProvider } from "@/server/email";
import { getSmsProvider } from "@/server/sms";
import { createTwoGyms, type World } from "../support/fixtures";
import { callApi, device } from "../support/mobile-api";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/**
 * Mobile API phase 1: authentication, devices, gym scoping and member invites, called through
 * the real route handlers against the test database (restricted app role, RLS on).
 */

type Tokens = { accessToken: string; refreshToken: string; sessionId: string; gyms: { slug: string; role: string; appAccess: { allowed: boolean } }[] };

const STAFF_PASSWORD = "Staff-Pass-2026";
let w: World;
let planId: string;

const login = (identifier: string, password = STAFF_PASSWORD, name = "Phone") =>
  callApi<Tokens>(loginRoute.POST, { body: { identifier, password, device: device(name) } });

async function staffToken(email = "owner.a@test.example", slug = "gym-a") {
  const { body } = await login(email);
  const scoped = await callApi<{ accessToken: string }>(selectGymRoute.POST, { token: body.accessToken, body: { gymSlug: slug } });
  return { ...body, gymToken: scoped.body.accessToken };
}

/** Capture what the email/SMS providers would send. */
function captureOutbox() {
  const sent: { to: string; text: string }[] = [];
  vi.spyOn(getEmailProvider(), "send").mockImplementation(async (m) => void sent.push({ to: m.to, text: m.text }));
  vi.spyOn(getSmsProvider(), "send").mockImplementation(async (m) => void sent.push({ to: m.to, text: m.text }));
  return sent;
}

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const db = getOwnerDb();
  const plan = await db.platformPlan.findUniqueOrThrow({ where: { code: "TEST" } });
  planId = plan.id;
  for (const g of [w.gymA, w.gymB]) {
    await db.gym.update({ where: { id: g.id }, data: { status: "ACTIVE" } });
    await db.gymSubscription.create({ data: { gymId: g.id, planId, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  }
  const hash = await hashPassword(STAFF_PASSWORD);
  await db.user.updateMany({ data: { passwordHash: hash } });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await appDb.$disconnect();
  await disconnectAll();
});

describe("password login", () => {
  it("rejects wrong passwords and unknown accounts with the same message", async () => {
    const wrong = await login("owner.a@test.example", "nope-nope-1A");
    const unknown = await login("nobody@test.example");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
    expect(wrong.body.error?.code).toBe("invalid_credentials");
  });

  it("signs in and lists the gyms the user can use in the app", async () => {
    const { status, body } = await login("Owner.A@test.example");
    expect(status).toBe(200);
    expect(body.accessToken.split(".")).toHaveLength(3);
    expect(body.refreshToken.length).toBeGreaterThan(40);
    expect(body.gyms).toEqual([{ slug: "gym-a", name: "Gym A", brandColor: expect.any(String), role: "OWNER", appAccess: { allowed: true, reason: null } }]);
    // Only the hash of the refresh token is stored — and the app role can't even read that table.
    const stored = await getOwnerDb().mobileRefreshToken.findFirstOrThrow({ where: { session: { id: body.sessionId } } });
    expect(stored.tokenHash).not.toBe(body.refreshToken);
    await expect(appDb.mobileRefreshToken.count()).rejects.toThrow(/permission denied/);
  });

  it("removed staff don't see that gym", async () => {
    const { body } = await login("removed.a@test.example");
    expect(body.gyms).toEqual([]);
  });

  it("is rate limited per account and IP", async () => {
    const ip = "203.0.113.77";
    for (let i = 0; i < 5; i++) await callApi(loginRoute.POST, { ip, body: { identifier: "desk.a@test.example", password: "Wrong-pass-1", device: device() } });
    const blocked = await callApi(loginRoute.POST, { ip, body: { identifier: "desk.a@test.example", password: STAFF_PASSWORD, device: device() } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });
});

describe("access tokens and gym scope", () => {
  it("needs a valid, untampered token", async () => {
    expect((await callApi(meRoute.GET)).status).toBe(401);
    const { accessToken } = (await login("owner.a@test.example")).body;
    expect((await callApi(meRoute.GET, { token: accessToken })).status).toBe(200);
    const [h, p, s] = accessToken.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: w.users.ownerB.id })).toString("base64url");
    expect((await callApi(meRoute.GET, { token: `${h}.${forged}.${s}` })).status).toBe(401);
  });

  it("scopes to a gym only after checking membership; the gym never comes from the request", async () => {
    const { accessToken } = (await login("owner.a@test.example")).body;
    // Before selecting, gym endpoints refuse.
    expect((await callApi(gymRoute.GET, { token: accessToken })).status).toBe(403);
    const other = await callApi(selectGymRoute.POST, { token: accessToken, body: { gymSlug: "gym-b" } });
    expect(other.status).toBe(404);
    const scoped = await callApi<{ accessToken: string; gym: { role: string; permissions: string[] } }>(selectGymRoute.POST, { token: accessToken, body: { gymSlug: "gym-a" } });
    expect(scoped.status).toBe(200);
    expect(scoped.body.gym.role).toBe("OWNER");
    const gym = await callApi<{ slug: string }>(gymRoute.GET, { token: scoped.body.accessToken, query: { gymId: w.gymB.id, gymSlug: "gym-b" } });
    expect(gym.body.slug).toBe("gym-a"); // query parameters are ignored
  });

  it("removal from the gym takes effect on the next request, not at token expiry", async () => {
    const t = await staffToken("desk.a@test.example");
    expect((await callApi(gymRoute.GET, { token: t.gymToken })).status).toBe(200);
    await getOwnerDb().staffMember.update({ where: { id: w.staff.deskA.id }, data: { status: "REMOVED" } });
    expect((await callApi(gymRoute.GET, { token: t.gymToken })).status).toBe(403);
    await getOwnerDb().staffMember.update({ where: { id: w.staff.deskA.id }, data: { status: "ACTIVE" } });
  });

  it("enforces the plan's mobile app feature on every request", async () => {
    const t = await staffToken();
    await getOwnerDb().platformPlan.update({ where: { id: planId }, data: { featureMobileApp: false } });
    try {
      const r = await callApi(gymRoute.GET, { token: t.gymToken });
      expect(r.status).toBe(402);
      expect(r.body.error?.code).toBe("feature_not_in_plan");
      expect((await callApi(selectGymRoute.POST, { token: t.accessToken, body: { gymSlug: "gym-a" } })).status).toBe(402);
    } finally {
      await getOwnerDb().platformPlan.update({ where: { id: planId }, data: { featureMobileApp: true } });
    }
  });
});

describe("refresh tokens", () => {
  it("rotate on every use; reusing an old one revokes the whole device session", async () => {
    const first = (await login("owner.a@test.example", STAFF_PASSWORD, "Rotating phone")).body;
    const r1 = await callApi<Tokens & { gym: { slug: string } | null }>(refreshRoute.POST, { body: { refreshToken: first.refreshToken, gymSlug: "gym-a" } });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(first.refreshToken);
    expect(r1.body.gym?.slug).toBe("gym-a");

    // The old token is replayed (stolen copy): the session dies, including the newest tokens.
    const replay = await callApi(refreshRoute.POST, { body: { refreshToken: first.refreshToken } });
    expect(replay.status).toBe(401);
    expect(replay.body.error?.code).toBe("session_revoked");
    expect((await callApi(refreshRoute.POST, { body: { refreshToken: r1.body.refreshToken } })).status).toBe(401);
    expect((await callApi(meRoute.GET, { token: r1.body.accessToken })).status).toBe(401);
    const session = await getOwnerDb().mobileDeviceSession.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect(session.revokeReason).toBe("refresh_reuse");
    expect(await getOwnerDb().platformAuditLog.count({ where: { action: "mobile.refresh_reuse" } })).toBe(1);
  });

  it("rejects unknown and expired tokens", async () => {
    expect((await callApi(refreshRoute.POST, { body: { refreshToken: "x".repeat(43) } })).body.error?.code).toBe("refresh_invalid");
    const t = (await login("owner.a@test.example")).body;
    await getOwnerDb().mobileRefreshToken.updateMany({ where: { sessionId: t.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await callApi(refreshRoute.POST, { body: { refreshToken: t.refreshToken } })).body.error?.code).toBe("session_expired");
  });
});

describe("devices", () => {
  it("lists signed-in devices and revokes one, ending its tokens", async () => {
    const phone = (await login("owner.b@test.example", STAFF_PASSWORD, "Pixel 9")).body;
    const tablet = (await login("owner.b@test.example", STAFF_PASSWORD, "iPad")).body;
    const list = await callApi<{ devices: { id: string; name: string; current: boolean }[] }>(devicesRoute.GET, { token: phone.accessToken });
    expect(list.body.devices.map((d) => d.name).sort()).toEqual(["Pixel 9", "iPad"]);
    expect(list.body.devices.find((d) => d.current)?.name).toBe("Pixel 9");

    expect((await callApi(deviceRoute.DELETE, { method: "DELETE", token: phone.accessToken, params: { deviceId: tablet.sessionId } })).status).toBe(200);
    expect((await callApi(meRoute.GET, { token: tablet.accessToken })).status).toBe(401);
    expect((await callApi(refreshRoute.POST, { body: { refreshToken: tablet.refreshToken } })).status).toBe(401);
    expect((await callApi(meRoute.GET, { token: phone.accessToken })).status).toBe(200);
  });

  it("can't touch another user's device", async () => {
    const mine = (await login("owner.a@test.example")).body;
    const theirs = (await login("owner.b@test.example")).body;
    expect((await callApi(deviceRoute.DELETE, { method: "DELETE", token: mine.accessToken, params: { deviceId: theirs.sessionId } })).status).toBe(404);
    expect((await callApi(meRoute.GET, { token: theirs.accessToken })).status).toBe(200);
  });

  it("logout ends this device session", async () => {
    const t = (await login("owner.b@test.example")).body;
    expect((await callApi(logoutRoute.POST, { token: t.accessToken })).status).toBe(200);
    expect((await callApi(meRoute.GET, { token: t.accessToken })).status).toBe(401);
  });
});

describe("password change", () => {
  it("needs the current password, then ends every session on every device", async () => {
    const a = (await login("owner.b@test.example", STAFF_PASSWORD, "A")).body;
    const b = (await login("owner.b@test.example", STAFF_PASSWORD, "B")).body;
    const bad = await callApi(passwordRoute.POST, { token: a.accessToken, body: { currentPassword: "wrong", newPassword: "Brand-New-Pass1", confirmPassword: "Brand-New-Pass1" } });
    expect(bad.status).toBe(422);
    const ok = await callApi(passwordRoute.POST, { token: a.accessToken, body: { currentPassword: STAFF_PASSWORD, newPassword: "Brand-New-Pass1", confirmPassword: "Brand-New-Pass1" } });
    expect(ok.status).toBe(200);
    for (const t of [a, b]) {
      expect((await callApi(meRoute.GET, { token: t.accessToken })).status).toBe(401);
      expect((await callApi(refreshRoute.POST, { body: { refreshToken: t.refreshToken } })).status).toBe(401);
    }
    expect((await login("owner.b@test.example", "Brand-New-Pass1")).status).toBe(200);
  });
});

describe("member app invites", () => {
  let memberToken: string;

  it("front desk creates a front-desk code (shown once, stored hashed)", async () => {
    const desk = await staffToken("desk.a@test.example");
    const r = await callApi<{ code: string; channel: string; inviteId: string }>(inviteRoute.POST, { token: desk.gymToken, params: { memberId: w.memberA.id }, body: { channel: "CODE" } });
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const stored = await getOwnerDb().memberAppInvite.findUniqueOrThrow({ where: { id: r.body.inviteId } });
    expect(stored.tokenHash).not.toContain(r.body.code.replace("-", ""));

    const look = await callApi<{ state: string; hasAccount: boolean; firstName: string; destination: string }>(inviteLookupRoute.POST, { body: { token: r.body.code.toLowerCase().replace("-", " ") } });
    expect(look.body).toMatchObject({ state: "valid", hasAccount: false, firstName: "Alice", destination: "a•••@example.com" });

    const weak = await callApi(inviteRedeemRoute.POST, { body: { token: r.body.code, password: "short", device: device() } });
    expect(weak.status).toBe(422);
    const redeemed = await callApi<Tokens>(inviteRedeemRoute.POST, { body: { token: r.body.code, name: "Alice Anand", password: "Member-Pass-1", device: device("Alice's phone") } });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.gyms).toEqual([expect.objectContaining({ slug: "gym-a", role: "MEMBER", appAccess: { allowed: true, reason: null } })]);
    expect((await callApi(inviteRedeemRoute.POST, { body: { token: r.body.code, password: "Member-Pass-1", device: device() } })).body.error?.message).toMatch(/already been used/);

    const scoped = await callApi<{ accessToken: string; gym: { role: string; permissions: string[] } }>(selectGymRoute.POST, { token: redeemed.body.accessToken, body: { gymSlug: "gym-a" } });
    expect(scoped.body.gym).toMatchObject({ role: "MEMBER", permissions: [] });
    memberToken = scoped.body.accessToken;
    // The new login works with the password they chose.
    expect((await login("alice@example.com", "Member-Pass-1")).status).toBe(200);
  });

  it("members can't use staff endpoints", async () => {
    const r = await callApi(inviteRoute.POST, { token: memberToken, params: { memberId: w.memberA.id }, body: { channel: "CODE" } });
    expect(r.status).toBe(403);
    expect((await callApi(gymRoute.GET, { token: memberToken })).status).toBe(200);
  });

  it("staff can only invite their own gym's members, and not twice", async () => {
    const desk = await staffToken("desk.a@test.example");
    expect((await callApi(inviteRoute.POST, { token: desk.gymToken, params: { memberId: w.memberB.id }, body: { channel: "CODE" } })).status).toBe(404);
    expect((await callApi(inviteRoute.POST, { token: desk.gymToken, params: { memberId: w.memberA.id }, body: { channel: "CODE" } })).body.error?.message).toMatch(/already uses the app/);
  });

  it("an emailed link can link an existing account after proving its password", async () => {
    const sent = captureOutbox();
    // Gym B's member Bob has the same email as Gym A's owner.
    await getOwnerDb().member.update({ where: { id: w.memberB.id }, data: { email: "owner.a@test.example" } });
    // (Owner B's password was changed in the password test above.)
    const ownerB = (await login("owner.b@test.example", "Brand-New-Pass1")).body;
    const ownerBToken = (await callApi<{ accessToken: string }>(selectGymRoute.POST, { token: ownerB.accessToken, body: { gymSlug: "gym-b" } })).body.accessToken;
    const r = await callApi<{ sentTo: string }>(inviteRoute.POST, { token: ownerBToken, params: { memberId: w.memberB.id }, body: { channel: "EMAIL" } });
    expect(r.status).toBe(201);
    expect(r.body.sentTo).toBe("o•••@test.example");
    const link = /\/app\/invite\/([\w-]+)/.exec(sent.at(-1)!.text)![1];

    expect((await callApi<{ hasAccount: boolean }>(inviteLookupRoute.POST, { body: { token: link } })).body.hasAccount).toBe(true);
    expect((await callApi(inviteRedeemRoute.POST, { body: { token: link, password: "Not-The-Pass1", device: device() } })).status).toBe(401);
    const linked = await callApi<Tokens>(inviteRedeemRoute.POST, { body: { token: link, password: STAFF_PASSWORD, device: device() } });
    expect(linked.status).toBe(200);
    // One login, two gyms with different roles: switch between them.
    expect(linked.body.gyms.map((g) => `${g.slug}:${g.role}`).sort()).toEqual(["gym-a:OWNER", "gym-b:MEMBER"]);
  });

  it("SMS invites create phone-only accounts that can sign in by phone", async () => {
    const sent = captureOutbox();
    const db = getOwnerDb();
    const phone = "+91 98765 43210";
    const carol = await db.member.create({ data: { gymId: w.gymA.id, memberNumber: 7, firstName: "Carol", lastName: "Cruz", checkInCode: "CCCC333333", phoneBlindIndex: phoneBlindIndex(w.gymA.id, phone), phoneEnc: "" } });
    await db.member.update({ where: { id: carol.id }, data: { phoneEnc: encryptField(phone, { gymId: w.gymA.id, model: "Member", field: "phone", recordId: carol.id }) } });
    const owner = await staffToken();
    const r = await callApi<{ sentTo: string }>(inviteRoute.POST, { token: owner.gymToken, params: { memberId: carol.id }, body: { channel: "SMS" } });
    expect(r.body.sentTo).toBe("•••• 3210");
    expect(sent.at(-1)!.to).toBe("+919876543210");
    const link = /\/app\/invite\/([\w-]+)/.exec(sent.at(-1)!.text)![1];
    expect((await callApi(inviteRedeemRoute.POST, { body: { token: link, name: "Carol Cruz", password: "Carol-Pass-11", device: device() } })).status).toBe(200);
    const user = await db.user.findFirstOrThrow({ where: { name: "Carol Cruz" } });
    expect(user.email).toBeNull();
    expect(user.phoneEnc).not.toContain("98765");
    expect((await login("098765 43210", "Carol-Pass-11")).status).toBe(200);
  });

  it("expired invites and plans without the member app are refused", async () => {
    const owner = await staffToken();
    const db = getOwnerDb();
    const dave = await db.member.create({ data: { gymId: w.gymA.id, memberNumber: 8, firstName: "Dave", lastName: "Dias", email: "dave@example.com", checkInCode: "DDDD444444" } });
    const r = await callApi<{ code: string; inviteId: string }>(inviteRoute.POST, { token: owner.gymToken, params: { memberId: dave.id }, body: { channel: "CODE" } });
    await db.platformPlan.update({ where: { id: planId }, data: { featureMemberApp: false } });
    try {
      expect((await callApi(inviteRedeemRoute.POST, { body: { token: r.body.code, password: "Dave-Pass-111", device: device() } })).status).toBe(402);
      expect((await callApi(inviteRoute.POST, { token: owner.gymToken, params: { memberId: dave.id }, body: { channel: "CODE" } })).status).toBe(402);
    } finally {
      await db.platformPlan.update({ where: { id: planId }, data: { featureMemberApp: true } });
    }
    await db.memberAppInvite.update({ where: { id: r.body.inviteId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await callApi(inviteRedeemRoute.POST, { body: { token: r.body.code, password: "Dave-Pass-111", device: device() } })).body.error?.message).toMatch(/expired/);
  });

  it("a disabled member account loses access on the next request", async () => {
    await getOwnerDb().memberAccount.update({ where: { memberId: w.memberA.id }, data: { status: "DISABLED" } });
    expect((await callApi(gymRoute.GET, { token: memberToken })).status).toBe(403);
  });
});

describe("one-time codes", () => {
  it("never reveals whether an account exists", async () => {
    const sent = captureOutbox();
    const before = sent.length;
    const r = await callApi(otpRequestRoute.POST, { body: { identifier: "ghost@test.example" } });
    expect(r.status).toBe(202);
    expect(sent.length).toBe(before);
  });

  it("signs in with a fresh code once; wrong codes are counted and lock the code", async () => {
    const sent = captureOutbox();
    expect((await callApi(otpRequestRoute.POST, { body: { identifier: "owner.a@test.example" } })).status).toBe(202);
    const code = /\b(\d{6})\b/.exec(sent.at(-1)!.text)![1];
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await callApi(otpVerifyRoute.POST, { body: { identifier: "owner.a@test.example", code: wrong, device: device() } })).status).toBe(401);
    expect((await callApi(otpVerifyRoute.POST, { body: { identifier: "owner.a@test.example", code, device: device() } })).status).toBe(200);
    expect((await callApi(otpVerifyRoute.POST, { body: { identifier: "owner.a@test.example", code, device: device() } })).status).toBe(401);

    await callApi(otpRequestRoute.POST, { body: { identifier: "owner.a@test.example" } });
    const second = /\b(\d{6})\b/.exec(sent.at(-1)!.text)![1];
    const bad = second === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await callApi(otpVerifyRoute.POST, { body: { identifier: "owner.a@test.example", code: bad, device: device() } });
    expect((await callApi(otpVerifyRoute.POST, { body: { identifier: "owner.a@test.example", code: second, device: device() } })).status).toBe(401); // burnt
    const stored = await getOwnerDb().loginOtp.findMany({ where: { userId: w.users.ownerA.id } });
    expect(stored.every((o) => !o.codeHash.includes(second))).toBe(true);
  });
});

describe("API hygiene", () => {
  it("validates input with consistent errors", async () => {
    const r = await callApi(loginRoute.POST, { body: { identifier: "x", password: "", device: { name: "", platform: "fridge" } } });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: "validation", fieldErrors: expect.any(Object) });
    expect((await callApi(loginRoute.POST, { rawBody: "{not json" })).status).toBe(400);
    expect((await callApi(loginRoute.POST, { rawBody: "a=1", contentType: "application/x-www-form-urlencoded" })).status).toBe(415);
  });

  it("serves an OpenAPI document generated from the contract", async () => {
    const res = openapiRoute.GET();
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/api/mobile/v1/auth/refresh");
  });
});
