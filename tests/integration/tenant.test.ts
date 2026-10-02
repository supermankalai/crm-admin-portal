import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appDb } from "@/server/db/client";
import { ForbiddenError, GymReadOnlyError, ValidationError } from "@/server/errors";
import { getGymOverview } from "@/server/services/gym-overview";
import { listMyGyms } from "@/server/services/my-gyms";
import { signupForExistingUser, signupWithNewOwner } from "@/server/services/signup";
import { assertCan, assertWritable } from "@/server/tenant/guards";
import { resolveTenant } from "@/server/tenant/resolve";
import { createTwoGyms, type World } from "../support/fixtures";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/**
 * The tenant layer and sign-up, using the real app services against gym_saas_test
 * through the restricted gym_app role.
 */

let w: World;
const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const asSessionUser = (u: { id: string; name: string; email: string }, isSuperAdmin = false) => ({ ...u, isSuperAdmin });

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const owner = getOwnerDb();
  const plan = await owner.platformPlan.findFirstOrThrow({ where: { code: "TEST" } });
  await owner.gymSubscription.createMany({
    data: [
      { gymId: w.gymA.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) },
      { gymId: w.gymB.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 40 * 86_400_000), currentPeriodEnd: new Date(Date.now() - 86_400_000) },
    ],
  });
  await owner.gym.update({ where: { id: w.gymA.id }, data: { status: "ACTIVE" } });
  await owner.gym.update({ where: { id: w.gymB.id }, data: { status: "ACTIVE" } });
  await owner.platformPlan.create({
    data: { code: "STARTER", name: "Starter", priceMonthlyMinor: 199900, maxMembers: 150, maxStaff: 8, maxLocations: 1, featureReports: false, featureCsvExport: false, featureClassBookings: true },
  });
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("resolveTenant (the only way a TenantContext is built)", () => {
  it("resolves a gym for its active staff with role, permissions, plan and access", async () => {
    const ctx = await resolveTenant(asSessionUser(w.users.ownerA), "gym-a");
    expect(ctx).not.toBeNull();
    expect(ctx!.gym.id).toBe(w.gymA.id);
    expect(ctx!.role).toBe("OWNER");
    expect(ctx!.permissions.has("settings.manage")).toBe(true);
    expect(ctx!.plan?.code).toBe("TEST");
    expect(ctx!.access.writable).toBe(true);
  });

  it("returns null for a gym the user does not belong to", async () => {
    expect(await resolveTenant(asSessionUser(w.users.ownerA), "gym-b")).toBeNull();
  });

  it("returns null for a removed staff member", async () => {
    expect(await resolveTenant(asSessionUser(w.users.removedA), "gym-a")).toBeNull();
  });

  it("returns null for a super admin without a staff role (no casual browsing)", async () => {
    expect(await resolveTenant(asSessionUser(w.users.superAdmin, true), "gym-b")).toBeNull();
  });

  it("rejects malformed slugs without touching the database", async () => {
    expect(await resolveTenant(asSessionUser(w.users.ownerA), "../gym-a")).toBeNull();
    expect(await resolveTenant(asSessionUser(w.users.ownerA), "GYM-A")).toBeNull();
  });

  it("front desk gets a narrower permission set", async () => {
    const ctx = await resolveTenant(asSessionUser(w.users.deskA), "gym-a");
    expect(ctx!.role).toBe("FRONT_DESK");
    expect(() => assertCan(ctx!, "payments.refund")).toThrow(ForbiddenError);
    expect(() => assertCan(ctx!, "checkin.perform")).not.toThrow();
  });

  it("an expired subscription makes the gym read-only for writes", async () => {
    const ctx = await resolveTenant(asSessionUser(w.users.ownerB), "gym-b");
    expect(ctx!.access).toMatchObject({ writable: false, reason: "subscription_expired" });
    expect(() => assertWritable(ctx!)).toThrow(GymReadOnlyError);
  });
});

describe("tenant-scoped services", () => {
  it("the overview counts only the current gym's rows", async () => {
    const ctxA = (await resolveTenant(asSessionUser(w.users.ownerA), "gym-a"))!;
    const overview = await getGymOverview(ctxA);
    expect(overview.members).toBe(1);
    expect(overview.staff).toBe(2); // owner + front desk (removed staff excluded)
  });
});

describe("gym sign-up", () => {
  it("creates the gym, owner, 14-day trial and defaults in one transaction", async () => {
    const result = await signupWithNewOwner(
      { gymName: "New Gym", slug: "new-gym", timezone: "Europe/London", currency: "GBP", planCode: "STARTER" },
      { ownerName: "Nia Owner", email: "nia@new.example", password: "Strong-Pass1" },
      meta
    );
    const owner = getOwnerDb();
    const gym = await owner.gym.findUniqueOrThrow({ where: { slug: "new-gym" }, include: { subscription: true, locations: true, openingHours: true, counters: true, staff: true } });
    expect(gym.id).toBe(result!.gymId);
    expect(gym).toMatchObject({ status: "TRIAL", timezone: "Europe/London", currency: "GBP" });
    expect(gym.subscription).toMatchObject({ status: "TRIALING" });
    const trialDays = (gym.subscription!.trialEndsAt!.getTime() - gym.createdAt.getTime()) / 86_400_000;
    expect(Math.round(trialDays)).toBe(14);
    expect(gym.locations).toHaveLength(1);
    expect(gym.openingHours).toHaveLength(7);
    expect(gym.counters.map((c) => c.key).sort()).toEqual(["invoice", "member"]);
    expect(gym.staff).toEqual([expect.objectContaining({ role: "OWNER", userId: result!.userId })]);

    const user = await owner.user.findUniqueOrThrow({ where: { id: result!.userId } });
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await owner.subscriptionHistory.count({ where: { gymId: gym.id, action: "TRIAL_STARTED" } })).toBe(1);
    expect(await owner.auditLog.count({ where: { gymId: gym.id, action: "gym.create" } })).toBe(1);
    expect(await owner.platformAuditLog.count({ where: { gymId: gym.id, action: "gym.signup" } })).toBe(1);

    // The new owner can immediately work in their gym, and only there.
    const ctx = await resolveTenant({ id: user.id, name: user.name, email: user.email, isSuperAdmin: false }, "new-gym");
    expect(ctx).toMatchObject({ role: "OWNER", access: { writable: true, isTrial: true } });
  });

  it("rejects a slug that is already taken, with a field error", async () => {
    await expect(
      signupWithNewOwner(
        { gymName: "Dup", slug: "gym-a", timezone: "Asia/Kolkata", currency: "INR", planCode: "STARTER" },
        { ownerName: "Dup Owner", email: "dup@new.example", password: "Strong-Pass1" },
        meta
      )
    ).rejects.toMatchObject({ fieldErrors: { slug: [expect.stringMatching(/already taken/)] } });
    expect(await getOwnerDb().user.count({ where: { email: "dup@new.example" } })).toBe(0); // nothing half-created
  });

  it("rejects an email that already has an account", async () => {
    const error = await signupWithNewOwner(
      { gymName: "Other", slug: "other-gym", timezone: "Asia/Kolkata", currency: "INR", planCode: "STARTER" },
      { ownerName: "Again", email: "OWNER.A@test.example", password: "Strong-Pass1" },
      meta
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors.email?.[0]).toMatch(/already exists/);
    expect(await getOwnerDb().gym.count({ where: { slug: "other-gym" } })).toBe(0);
  });

  it("rejects an unknown plan", async () => {
    await expect(
      signupWithNewOwner(
        { gymName: "Plan", slug: "plan-gym", timezone: "Asia/Kolkata", currency: "INR", planCode: "PLATINUM" },
        { ownerName: "P", email: "p@new.example", password: "Strong-Pass1" },
        meta
      )
    ).rejects.toMatchObject({ fieldErrors: { planCode: [expect.any(String)] } });
  });

  it("a signed-in user can add another gym and then switch between both", async () => {
    await signupForExistingUser(w.users.deskA.id, { gymName: "Desk's Own Gym", slug: "desk-own", timezone: "Asia/Kolkata", currency: "INR", planCode: "STARTER" }, meta);
    const gyms = await listMyGyms(w.users.deskA.id);
    expect(gyms.map((g) => [g.gym.slug, g.role])).toEqual([
      ["desk-own", "OWNER"],
      ["gym-a", "FRONT_DESK"],
    ]);
  });

  it("the sign-up function cannot be used to escalate: an anonymous call needs a full new owner", async () => {
    const error = await signupWithNewOwner(
      { gymName: "Bad", slug: "bad-gym", timezone: "Asia/Kolkata", currency: "INR", planCode: "STARTER" },
      { ownerName: "", email: "", password: "" },
      meta
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
  });
});
