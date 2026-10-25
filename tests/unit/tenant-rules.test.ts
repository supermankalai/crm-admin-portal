import { describe, expect, it } from "vitest";
import { assignableRoles, can, PERMISSIONS, permissionsFor } from "@/domain/permissions";
import { slugify, slugProblem } from "@/domain/slug";
import { computeSubscriptionAccess } from "@/domain/subscription-access";
import { signupExistingUserSchema, signupNewUserSchema } from "@/lib/validation/signup";

describe("role permissions", () => {
  it("owners can do everything", () => {
    expect(permissionsFor("OWNER")).toEqual([...PERMISSIONS]);
  });

  it("only owners manage settings, billing and the audit log", () => {
    for (const role of ["MANAGER", "FRONT_DESK", "TRAINER"] as const) {
      expect(can(role, "settings.manage")).toBe(false);
      expect(can(role, "billing.manage")).toBe(false);
      expect(can(role, "audit.view")).toBe(false);
    }
  });

  it("managers run the gym but cannot manage staff roles", () => {
    expect(can("MANAGER", "payments.refund")).toBe(true);
    expect(can("MANAGER", "reports.view")).toBe(true);
    expect(can("MANAGER", "staff.invite")).toBe(true);
    expect(can("MANAGER", "staff.manage")).toBe(false);
  });

  it("front desk checks in, signs up members and records payments, but cannot refund or see reports", () => {
    expect(can("FRONT_DESK", "checkin.perform")).toBe(true);
    expect(can("FRONT_DESK", "members.create")).toBe(true);
    expect(can("FRONT_DESK", "payments.record")).toBe(true);
    expect(can("FRONT_DESK", "payments.refund")).toBe(false);
    expect(can("FRONT_DESK", "reports.view")).toBe(false);
    expect(can("FRONT_DESK", "dashboard.financials")).toBe(false);
  });

  it("trainers only see their own clients and classes", () => {
    expect(can("TRAINER", "members.view")).toBe(true);
    expect(can("TRAINER", "members.viewAll")).toBe(false);
    expect(can("TRAINER", "classes.manageOwn")).toBe(true);
    expect(can("TRAINER", "classes.manage")).toBe(false);
    expect(can("TRAINER", "payments.view")).toBe(false);
    expect(can("TRAINER", "checkin.perform")).toBe(false);
  });

  it("only owners can create owners and managers", () => {
    expect(assignableRoles("OWNER")).toContain("MANAGER");
    expect(assignableRoles("MANAGER")).toEqual(["FRONT_DESK", "TRAINER"]);
    expect(assignableRoles("FRONT_DESK")).toEqual([]);
    expect(assignableRoles("TRAINER")).toEqual([]);
  });
});

describe("subscription access (read-only mode)", () => {
  const now = new Date("2026-10-02T10:00:00Z");
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

  it("an active, paid-up gym is writable", () => {
    const a = computeSubscriptionAccess("ACTIVE", { status: "ACTIVE", currentPeriodEnd: inDays(10), trialEndsAt: null }, now);
    expect(a).toMatchObject({ writable: true, reason: null, isTrial: false, daysRemaining: 10 });
  });

  it("a trial counts down to the trial end", () => {
    const a = computeSubscriptionAccess("TRIAL", { status: "TRIALING", currentPeriodEnd: inDays(9), trialEndsAt: inDays(9) }, now);
    expect(a).toMatchObject({ writable: true, isTrial: true, daysRemaining: 9 });
  });

  it("becomes read-only the moment the period ends, even if no job has run", () => {
    const end = new Date(now.getTime());
    expect(computeSubscriptionAccess("ACTIVE", { status: "ACTIVE", currentPeriodEnd: end, trialEndsAt: null }, now)).toMatchObject({
      writable: false,
      reason: "subscription_expired",
    });
    expect(computeSubscriptionAccess("TRIAL", { status: "TRIALING", currentPeriodEnd: inDays(-1), trialEndsAt: inDays(-1) }, now)).toMatchObject({
      writable: false,
      reason: "trial_ended",
    });
  });

  it("suspended and cancelled gyms are read-only regardless of dates", () => {
    const sub = { status: "ACTIVE" as const, currentPeriodEnd: inDays(30), trialEndsAt: null };
    expect(computeSubscriptionAccess("SUSPENDED", sub, now)).toMatchObject({ writable: false, reason: "suspended" });
    expect(computeSubscriptionAccess("CANCELLED", sub, now)).toMatchObject({ writable: false, reason: "cancelled" });
    expect(computeSubscriptionAccess("ACTIVE", { ...sub, status: "EXPIRED" }, now)).toMatchObject({ writable: false, reason: "subscription_expired" });
  });

  it("rounds days left up, so a fresh 14-day trial shows 14", () => {
    const almost14 = new Date(now.getTime() + 14 * 86_400_000 - 5_000);
    expect(computeSubscriptionAccess("TRIAL", { status: "TRIALING", currentPeriodEnd: almost14, trialEndsAt: almost14 }, now).daysRemaining).toBe(14);
  });

  it("no subscription means read-only", () => {
    expect(computeSubscriptionAccess("ACTIVE", null, now)).toMatchObject({ writable: false, reason: "no_subscription" });
  });
});

describe("gym slugs", () => {
  it.each([
    ["Iron Temple Fitness", "iron-temple-fitness"],
    ["  Zen & Strength!! ", "zen-and-strength"],
    ["Café Fit 24/7", "cafe-fit-24-7"],
  ])("slugify(%j) → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("rejects reserved, malformed and too-short slugs", () => {
    expect(slugProblem("admin")).toMatch(/reserved/);
    expect(slugProblem("ab")).toMatch(/at least 3/);
    expect(slugProblem("-gym")).toBeTruthy();
    expect(slugProblem("Gym")).toBeTruthy();
    expect(slugProblem("my--gym")).toMatch(/single hyphens/);
    expect(slugProblem("iron-temple")).toBeNull();
  });
});

describe("sign-up validation (shared by wizard and server)", () => {
  const base = { gymName: "Test Gym", slug: "test-gym", timezone: "Asia/Kolkata", currency: "INR", planCode: "growth" };

  it("accepts a complete new-owner payload and normalises it", () => {
    const parsed = signupNewUserSchema.parse({ ...base, ownerName: "Asha", email: " Asha@Example.COM ", password: "Strong-Pass1", confirmPassword: "Strong-Pass1" });
    expect(parsed.email).toBe("asha@example.com");
    expect(parsed.planCode).toBe("GROWTH");
  });

  it("rejects mismatched passwords, weak passwords and bad time zones", () => {
    const result = signupNewUserSchema.safeParse({ ...base, timezone: "Mars/Olympus", ownerName: "A", email: "x", password: "weak", confirmPassword: "other" });
    expect(result.success).toBe(false);
    const fields = new Set(result.error!.issues.map((i) => i.path[0]));
    expect([...fields]).toEqual(expect.arrayContaining(["timezone", "ownerName", "email", "password", "confirmPassword"]));
  });

  it("signed-in users only need gym details and a plan", () => {
    expect(signupExistingUserSchema.safeParse(base).success).toBe(true);
    expect(signupExistingUserSchema.safeParse({ ...base, slug: "api" }).success).toBe(false);
  });
});
