import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import * as fileRoute from "@/app/api/mobile/v1/files/[fileId]/route";
import * as loginRoute from "@/app/api/mobile/v1/auth/login/route";
import * as refreshRoute from "@/app/api/mobile/v1/auth/refresh/route";
import * as selectGymRoute from "@/app/api/mobile/v1/auth/select-gym/route";
import * as meRoute from "@/app/api/mobile/v1/me/route";
import { hashPassword } from "@/server/auth/password";
import { appDb } from "@/server/db/client";
import { signedFilePath } from "@/server/mobile/files";
import { setGymLogo } from "@/server/services/settings";
import { resolveTenant } from "@/server/tenant/resolve";
import { createTwoGyms, type World } from "../support/fixtures";
import { callApi, device } from "../support/mobile-api";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/** Mobile Phase 2 server pieces: gym logos via signed URLs, and refresh that survives losing a gym. */

const PASSWORD = "Staff-Pass-2026";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001", "hex");
let w: World;
let logoId: string;

async function fetchFile(path: string) {
  const url = new URL(path, "http://localhost");
  const fileId = decodeURIComponent(url.pathname.split("/").pop()!);
  const res = await fileRoute.GET(new NextRequest(url), { params: Promise.resolve({ fileId }) });
  return { status: res.status, type: res.headers.get("content-type"), cache: res.headers.get("cache-control") };
}

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const db = getOwnerDb();
  const plan = await db.platformPlan.findUniqueOrThrow({ where: { code: "TEST" } });
  for (const g of [w.gymA, w.gymB]) {
    await db.gym.update({ where: { id: g.id }, data: { status: "ACTIVE" } });
    await db.gymSubscription.create({ data: { gymId: g.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  }
  await db.user.updateMany({ data: { passwordHash: await hashPassword(PASSWORD) } });
  // A member app account for Alice in gym A.
  const alice = await db.user.create({ data: { email: "alice.app@test.example", name: "Alice", passwordHash: await hashPassword(PASSWORD) } });
  await db.memberAccount.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, userId: alice.id } });
  const owner = (await resolveTenant({ ...w.users.ownerA, isSuperAdmin: false }, "gym-a"))!;
  await setGymLogo(owner, PNG, { ip: null, userAgent: null });
  logoId = (await db.gym.findUniqueOrThrow({ where: { id: w.gymA.id } })).logoFileId!;
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("gym logos for the app", () => {
  it("staff and members get a short-lived signed logo URL that serves the image", async () => {
    for (const email of ["owner.a@test.example", "alice.app@test.example"]) {
      const login = await callApi<{ accessToken: string; gyms: { slug: string; logoUrl: string | null }[] }>(loginRoute.POST, { body: { identifier: email, password: PASSWORD, device: device() } });
      const listed = login.body.gyms.find((g) => g.slug === "gym-a")!;
      expect(listed.logoUrl).toMatch(/^\/api\/mobile\/v1\/files\/[\w-]+\?u=.+&g=.+&e=\d+&s=/);
      const scoped = await callApi<{ gym: { logoUrl: string } }>(selectGymRoute.POST, { token: login.body.accessToken, body: { gymSlug: "gym-a" } });
      const file = await fetchFile(scoped.body.gym.logoUrl);
      expect(file).toMatchObject({ status: 200, type: "image/png", cache: "private, max-age=300" });
    }
  });

  it("rejects tampered, expired or borrowed URLs", async () => {
    const good = signedFilePath(logoId, w.users.ownerA.id, w.gymA.id);
    expect((await fetchFile(good)).status).toBe(200);
    expect((await fetchFile(good.replace(/s=[^&]+/, "s=AAAA"))).status).toBe(404);
    expect((await fetchFile(good.replace(`u=${w.users.ownerA.id}`, `u=${w.users.ownerB.id}`))).status).toBe(404);
    const expired = signedFilePath(logoId, w.users.ownerA.id, w.gymA.id, Date.now() - 10 * 60_000);
    expect((await fetchFile(expired)).status).toBe(404);
    // A validly signed URL for someone with no access to that gym is still refused.
    expect((await fetchFile(signedFilePath(logoId, w.users.ownerB.id, w.gymA.id))).status).toBe(404);
    // Members can't use the file route for other files (e.g. member photos).
    const alice = await getOwnerDb().user.findUniqueOrThrow({ where: { email: "alice.app@test.example" } });
    const otherFile = await getOwnerDb().fileAsset.create({ data: { gymId: w.gymA.id, kind: "MEMBER_PHOTO", storageKey: "x/y.png", mimeType: "image/png", sizeBytes: 1, sha256: "0", uploadedById: w.staff.ownerA.id } });
    expect((await fetchFile(signedFilePath(otherFile.id, alice.id, w.gymA.id))).status).toBe(404);
  });

  it("revoking access stops a link that was already handed out", async () => {
    const alice = await getOwnerDb().user.findUniqueOrThrow({ where: { email: "alice.app@test.example" } });
    const link = signedFilePath(logoId, alice.id, w.gymA.id);
    expect((await fetchFile(link)).status).toBe(200);
    await getOwnerDb().memberAccount.update({ where: { memberId: w.memberA.id }, data: { status: "DISABLED" } });
    expect((await fetchFile(link)).status).toBe(404);
    await getOwnerDb().memberAccount.update({ where: { memberId: w.memberA.id }, data: { status: "ACTIVE" } });
  });
});

describe("refresh when the gym can no longer be used", () => {
  it("still rotates the token and reports the gym problem instead of failing", async () => {
    const login = await callApi<{ accessToken: string; refreshToken: string }>(loginRoute.POST, { body: { identifier: "desk.a@test.example", password: PASSWORD, device: device() } });
    await getOwnerDb().staffMember.update({ where: { id: w.staff.deskA.id }, data: { status: "REMOVED" } });
    try {
      const r = await callApi<{ refreshToken: string; accessToken: string; gym: unknown; gymError: { code: string; message: string } | null }>(refreshRoute.POST, { body: { refreshToken: login.body.refreshToken, gymSlug: "gym-a" } });
      expect(r.status).toBe(200);
      expect(r.body.gym).toBeNull();
      expect(r.body.gymError?.message).toBe("Gym not found.");
      // The new tokens work (no false "reuse" on the next refresh).
      expect((await callApi(meRoute.GET, { token: r.body.accessToken })).status).toBe(200);
      expect((await callApi(refreshRoute.POST, { body: { refreshToken: r.body.refreshToken } })).status).toBe(200);
    } finally {
      await getOwnerDb().staffMember.update({ where: { id: w.staff.deskA.id }, data: { status: "ACTIVE" } });
    }
  });
});
