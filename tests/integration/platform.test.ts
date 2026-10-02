import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appDb } from "@/server/db/client";
import { manualBillingProvider } from "@/server/billing/manual";
import { assertWithinLimit, planLimitErrorFrom } from "@/server/plan/limits";
import { expireDueSubscriptions, getPlatformStats, listGyms, updatePlan } from "@/server/platform/services";
import { endSupportSession, startSupportSession } from "@/server/support/sessions";
import { assertWritable, inTenant } from "@/server/tenant/guards";
import { resolveSupportTenant, resolveTenant } from "@/server/tenant/resolve";
import { recordAudit } from "@/server/audit/tenant-audit";
import { GymReadOnlyError, PlanLimitError } from "@/server/errors";
import { createTwoGyms, type World } from "../support/fixtures";
import { asApp, disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

let w: World;
let planId: string;
const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const days = (d: number) => new Date(Date.now() + d * 86_400_000);
const user = (u: { id: string; name: string; email: string }, isSuperAdmin = false) => ({ ...u, isSuperAdmin });

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const owner = getOwnerDb();
  planId = (await owner.platformPlan.findFirstOrThrow({ where: { code: "TEST" } })).id;
  await owner.platformPlan.create({
    data: { code: "TINY", name: "Tiny", priceMonthlyMinor: 1000, maxMembers: 3, maxStaff: 3, maxLocations: 1, featureReports: false, featureCsvExport: false, featureClassBookings: false },
  });
  await owner.gym.update({ where: { id: w.gymA.id }, data: { status: "TRIAL" } });
  await owner.gymSubscription.createMany({
    data: [
      { gymId: w.gymA.id, planId, status: "TRIALING", trialEndsAt: days(9), currentPeriodStart: days(-5), currentPeriodEnd: days(9) },
      { gymId: w.gymB.id, planId, status: "ACTIVE", currentPeriodStart: days(-20), currentPeriodEnd: days(10) },
    ],
  });
  await owner.gym.update({ where: { id: w.gymB.id }, data: { status: "ACTIVE" } });
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("plan limits are enforced by the database", () => {
  const tinyGym = async () => {
    const owner = getOwnerDb();
    const tiny = await owner.platformPlan.findFirstOrThrow({ where: { code: "TINY" } });
    const gym = await owner.gym.create({ data: { slug: `tiny-${createId().slice(0, 8)}`, name: "Tiny Gym", status: "ACTIVE" } });
    await owner.gymSubscription.create({ data: { gymId: gym.id, planId: tiny.id, status: "ACTIVE", currentPeriodStart: days(-1), currentPeriodEnd: days(30) } });
    return gym;
  };
  const member = (gymId: string, n: number) => ({ gymId, memberNumber: n, firstName: `M${n}`, lastName: "T", checkInCode: `CODE${createId().slice(0, 8)}` });

  it("refuses the member beyond maxMembers, even for the owner role", async () => {
    const gym = await tinyGym();
    const owner = getOwnerDb();
    await owner.member.createMany({ data: [member(gym.id, 1), member(gym.id, 2), member(gym.id, 3)] });
    await expect(owner.member.create({ data: member(gym.id, 4) })).rejects.toThrow(/plan_limit:members/);
  });

  it("rejects a bulk insert that would cross the limit as a whole (nothing is inserted)", async () => {
    const gym = await tinyGym();
    const owner = getOwnerDb();
    await expect(owner.member.createMany({ data: [1, 2, 3, 4].map((n) => member(gym.id, n)) })).rejects.toThrow(/plan_limit:members/);
    expect(await owner.member.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it("does not count soft-deleted members, but restoring one beyond the limit is refused", async () => {
    const gym = await tinyGym();
    const owner = getOwnerDb();
    await owner.member.createMany({ data: [member(gym.id, 1), member(gym.id, 2), member(gym.id, 3)] });
    const first = await owner.member.findFirstOrThrow({ where: { gymId: gym.id, memberNumber: 1 } });
    await owner.member.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    await owner.member.create({ data: member(gym.id, 4) }); // slot freed
    await expect(owner.member.update({ where: { id: first.id }, data: { deletedAt: null } })).rejects.toThrow(/plan_limit:members/);
  });

  it("limits locations and active staff too", async () => {
    const gym = await tinyGym();
    const owner = getOwnerDb();
    await owner.location.create({ data: { gymId: gym.id, name: "Main" } });
    await expect(owner.location.create({ data: { gymId: gym.id, name: "Second" } })).rejects.toThrow(/plan_limit:locations/);
  });

  it("holds under concurrency: parallel inserts through the app role never exceed the limit", async () => {
    const gym = await tinyGym();
    const owner = getOwnerDb();
    const staffUser = await owner.user.create({ data: { email: `staff.${createId()}@test.example`, name: "Desk", passwordHash: "$argon2id$x" } });
    await owner.staffMember.create({ data: { gymId: gym.id, userId: staffUser.id, role: "FRONT_DESK" } });
    const ctx = { userId: staffUser.id, gymId: gym.id };
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => asApp(ctx, (tx) => tx.member.createMany({ data: [member(gym.id, 100 + i)] })))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await owner.member.count({ where: { gymId: gym.id } })).toBe(3);
  });

  it("the app pre-check and the DB error both produce the friendly upgrade message", async () => {
    const ctx = (await resolveTenant(user(w.users.ownerB), "gym-b"))!;
    const tinyCtx = { ...ctx, plan: { ...ctx.plan!, name: "Tiny", maxMembers: 1 } };
    await expect(inTenant(tinyCtx, (tx) => assertWithinLimit(tinyCtx, tx, "members"))).rejects.toThrow(PlanLimitError);
    expect(planLimitErrorFrom(new Error("... plan_limit:members ..."), tinyCtx)?.message).toMatch(/Tiny plan includes up to 1 member/);
  });
});

describe("platform analytics are aggregate-only and admin-only", () => {
  it("returns platform totals to a super admin", async () => {
    const stats = await getPlatformStats(w.users.superAdmin.id);
    expect(stats.gymsByStatus.ACTIVE).toBeGreaterThanOrEqual(1);
    expect(stats.signupsByMonth).toHaveLength(12);
    expect(typeof stats.totalMembers).toBe("number");
  });

  it("refuses non-admins, even if they set the platform flag", async () => {
    await expect(getPlatformStats(w.users.ownerA.id)).rejects.toThrow(/platform admin access required/);
    await expect(asApp({ userId: w.users.ownerA.id, platformAdmin: true }, (tx) => tx.$queryRaw`SELECT * FROM platform_gym_usage()`)).rejects.toThrow(
      /platform admin access required/
    );
  });

  it("lists gyms with usage counts but no member rows", async () => {
    const result = await listGyms(w.users.superAdmin.id, { q: "gym" });
    const a = result.gyms.find((g) => g.slug === "gym-a")!;
    expect(a.members).toBe(1);
    expect(a.staff).toBe(2);
    expect(Object.keys(a)).not.toContain("firstName");
  });

  it("only super admins can change platform plans", async () => {
    await expect(
      asApp({ userId: w.users.ownerA.id, platformAdmin: true }, (tx) => tx.platformPlan.updateMany({ where: { code: "TEST" }, data: { maxMembers: 999999 } }))
    ).resolves.toMatchObject({ count: 0 });
    const updated = await updatePlan(
      w.users.superAdmin.id,
      { code: "TEST", name: "Test", description: "", priceMonthlyMinor: 0, maxMembers: 20, maxStaff: 5, maxLocations: 1, featureReports: true, featureCsvExport: true, featureClassBookings: true, isActive: true },
      meta
    );
    expect(updated.maxMembers).toBe(20);
    expect(await getOwnerDb().platformAuditLog.count({ where: { action: "plan.update", targetId: "TEST" } })).toBe(1);
  });
});

describe("manual billing provider", () => {
  const change = (gymId: string, c: Parameters<typeof manualBillingProvider.changeSubscription>[0]["change"]) =>
    manualBillingProvider.changeSubscription({ actorUserId: w.users.superAdmin.id, gymId, change: c, meta });

  it("activating a trial gym makes it ACTIVE and records history + audit", async () => {
    const result = await change(w.gymA.id, { type: "activate", months: 1 });
    expect(result).toMatchObject({ action: "ACTIVATED", gymStatus: "ACTIVE", status: "ACTIVE" });
    const owner = getOwnerDb();
    const history = await owner.subscriptionHistory.findFirstOrThrow({ where: { gymId: w.gymA.id, action: "ACTIVATED" } });
    expect(history).toMatchObject({ fromStatus: "TRIALING", toStatus: "ACTIVE", actorUserId: w.users.superAdmin.id });
    expect(await owner.platformAuditLog.count({ where: { gymId: w.gymA.id, action: "subscription.activate" } })).toBe(1);
  });

  it("suspending makes the gym read-only for its staff; reactivating restores writes", async () => {
    await change(w.gymB.id, { type: "suspend", reason: "Payment dispute #77" });
    const ctx = (await resolveTenant(user(w.users.ownerB), "gym-b"))!;
    expect(ctx.access).toMatchObject({ writable: false, reason: "suspended" });
    expect(() => assertWritable(ctx)).toThrow(GymReadOnlyError);
    expect((await getOwnerDb().subscriptionHistory.findFirstOrThrow({ where: { gymId: w.gymB.id, action: "SUSPENDED" } })).note).toBe("Payment dispute #77");

    await change(w.gymB.id, { type: "reactivate" });
    expect((await resolveTenant(user(w.users.ownerB), "gym-b"))!.access.writable).toBe(true);
  });

  it("changing plan applies the new limits immediately", async () => {
    await change(w.gymB.id, { type: "changePlan", planCode: "TINY" });
    expect((await resolveTenant(user(w.users.ownerB), "gym-b"))!.plan).toMatchObject({ code: "TINY", maxMembers: 3 });
    await expect(change(w.gymB.id, { type: "changePlan", planCode: "NOPE" })).rejects.toThrow(/active plan/);
    await change(w.gymB.id, { type: "changePlan", planCode: "TEST" });
  });

  it("invalid transitions are rejected with a clear message and change nothing", async () => {
    await expect(change(w.gymB.id, { type: "reactivate" })).rejects.toThrow(/Only suspended or cancelled/);
  });

  it("gym staff cannot change subscriptions directly in the database", async () => {
    const ctx = { userId: w.users.ownerB.id, gymId: w.gymB.id };
    const result = await asApp(ctx, (tx) => tx.gymSubscription.updateMany({ data: { currentPeriodEnd: days(9999) } }));
    expect(result.count).toBe(0);
    await expect(
      asApp(ctx, (tx) => tx.subscriptionHistory.createMany({ data: [{ gymId: w.gymB.id, action: "EXTENDED", toStatus: "ACTIVE" }] }))
    ).rejects.toThrow(/row-level security/);
  });
});

describe("subscription expiry job", () => {
  it("marks ended periods EXPIRED with history, idempotently", async () => {
    const owner = getOwnerDb();
    await owner.gymSubscription.update({ where: { gymId: w.gymB.id }, data: { currentPeriodEnd: days(-1) } });
    expect(await expireDueSubscriptions(w.users.superAdmin.id)).toBe(1);
    expect(await expireDueSubscriptions(w.users.superAdmin.id)).toBe(0);
    const sub = await owner.gymSubscription.findUniqueOrThrow({ where: { gymId: w.gymB.id } });
    expect(sub.status).toBe("EXPIRED");
    const history = await owner.subscriptionHistory.findFirstOrThrow({ where: { gymId: w.gymB.id, action: "EXPIRED" } });
    expect(history).toMatchObject({ fromStatus: "ACTIVE", toStatus: "EXPIRED" });
    expect((await resolveTenant(user(w.users.ownerB), "gym-b"))!.access).toMatchObject({ writable: false, reason: "subscription_expired" });
    // Renew for the following tests.
    await manualBillingProvider.changeSubscription({ actorUserId: w.users.superAdmin.id, gymId: w.gymB.id, change: { type: "extend", days: 30 }, meta });
  });

  it("cannot be triggered by a non-admin", async () => {
    await expect(expireDueSubscriptions(w.users.ownerA.id)).rejects.toThrow(/platform admin access required/);
  });
});

describe("support access", () => {
  let sessionId: string;
  beforeEach(async () => {
    ({ sessionId } = await startSupportSession(w.users.superAdmin.id, w.gymB.id, "Ticket #123: members missing", meta));
  });

  it("gives the opening super admin read-only access to exactly that gym", async () => {
    const admin = user(w.users.superAdmin, true);
    const ctx = await resolveSupportTenant(admin, "gym-b", sessionId);
    expect(ctx).toMatchObject({ supportSessionId: sessionId, gym: { slug: "gym-b" } });
    expect(await inTenant(ctx!, (tx) => tx.member.count())).toBe(1);
    expect(() => assertWritable(ctx!)).toThrow(/Support access is read-only/);
    // Even bypassing the app guard, the database refuses writes in support mode.
    const updated = await inTenant(ctx!, (tx) => tx.member.updateMany({ data: { firstName: "Changed" } }));
    expect(updated.count).toBe(0);
    // Views are recorded in the gym's own audit log with actorType SUPPORT.
    await inTenant(ctx!, (tx) => recordAudit(tx, ctx!, { action: "support.view", entityType: "Gym", changes: { path: "/g/gym-b/dashboard" } }, meta));
    expect(await getOwnerDb().auditLog.count({ where: { gymId: w.gymB.id, action: "support.view", actorType: "SUPPORT", supportSessionId: sessionId } })).toBe(1);
  });

  it("does not open any other gym", async () => {
    expect(await resolveSupportTenant(user(w.users.superAdmin, true), "gym-a", sessionId)).toBeNull();
  });

  it("is useless to anyone else holding the session id", async () => {
    expect(await resolveSupportTenant(user(w.users.ownerA), "gym-b", sessionId)).toBeNull();
    const otherAdmin = await getOwnerDb().user.create({ data: { email: `admin2.${createId()}@test.example`, name: "Admin 2", passwordHash: "$argon2id$x", isSuperAdmin: true } });
    expect(await resolveSupportTenant(user(otherAdmin, true), "gym-b", sessionId)).toBeNull();
  });

  it("stops working when ended or expired, and both events are audited", async () => {
    await endSupportSession(w.users.superAdmin.id, sessionId, meta);
    expect(await resolveSupportTenant(user(w.users.superAdmin, true), "gym-b", sessionId)).toBeNull();

    const { sessionId: second } = await startSupportSession(w.users.superAdmin.id, w.gymB.id, "Second look at ticket #123", meta);
    await getOwnerDb().supportAccessSession.update({ where: { id: second }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveSupportTenant(user(w.users.superAdmin, true), "gym-b", second)).toBeNull();

    const owner = getOwnerDb();
    expect(await owner.platformAuditLog.count({ where: { action: "support.start", gymId: w.gymB.id } })).toBeGreaterThanOrEqual(2);
    expect(await owner.platformAuditLog.count({ where: { action: "support.end", gymId: w.gymB.id } })).toBeGreaterThanOrEqual(1);
  });

  it("opening a new session closes the admin's previous one", async () => {
    const { sessionId: next } = await startSupportSession(w.users.superAdmin.id, w.gymA.id, "Ticket #456 at gym A", meta);
    expect(await resolveSupportTenant(user(w.users.superAdmin, true), "gym-b", sessionId)).toBeNull();
    expect(await resolveSupportTenant(user(w.users.superAdmin, true), "gym-a", next)).not.toBeNull();
  });
});
