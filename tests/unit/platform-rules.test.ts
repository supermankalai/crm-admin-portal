import { describe, expect, it } from "vitest";
import { checkLimit, featureMessage, limitMessage, usageLevel, type PlanLimits } from "@/domain/plan-limits";
import { applySubscriptionChange, InvalidSubscriptionChange, type SubscriptionState } from "@/domain/subscription-changes";

const starter: PlanLimits = { name: "Starter", maxMembers: 150, maxStaff: 8, maxLocations: 1, features: { reports: false, csvExport: false, classBookings: true } };

describe("plan limits", () => {
  it("allows up to and including the limit", () => {
    expect(checkLimit(starter, "members", 149)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkLimit(starter, "members", 150)).toMatchObject({ allowed: false, remaining: 0 });
    expect(checkLimit(starter, "staff", 7, 2)).toMatchObject({ allowed: false });
    expect(checkLimit(starter, "locations", 0)).toMatchObject({ allowed: true, limit: 1 });
  });

  it("explains the limit and how to lift it", () => {
    expect(limitMessage(starter, "members")).toBe("Your Starter plan includes up to 150 members, and you've reached it. Upgrade your plan to add more.");
    expect(limitMessage(starter, "locations")).toContain("up to 1 location,");
    expect(featureMessage(starter, "csvExport")).toBe("CSV export isn't included in your Starter plan. Upgrade your plan to use it.");
  });

  it("classifies usage for meters", () => {
    expect(usageLevel(10, 150)).toBe("ok");
    expect(usageLevel(120, 150)).toBe("near");
    expect(usageLevel(150, 150)).toBe("full");
  });
});

describe("manual subscription changes", () => {
  const now = new Date("2026-10-02T00:00:00Z");
  const days = (d: number) => new Date(now.getTime() + d * 86_400_000);
  const trial: SubscriptionState = { gymStatus: "TRIAL", status: "TRIALING", planId: "growth", currentPeriodStart: days(-5), currentPeriodEnd: days(9), trialEndsAt: days(9) };
  const active: SubscriptionState = { gymStatus: "ACTIVE", status: "ACTIVE", planId: "pro", currentPeriodStart: days(-20), currentPeriodEnd: days(10), trialEndsAt: null };
  const expired: SubscriptionState = { ...active, status: "EXPIRED", currentPeriodEnd: days(-3) };

  it("activating a trial starts a paid period now", () => {
    const { next, action } = applySubscriptionChange(trial, { type: "activate", months: 1 }, now);
    expect(action).toBe("ACTIVATED");
    expect(next).toMatchObject({ gymStatus: "ACTIVE", status: "ACTIVE", currentPeriodStart: now });
    expect(next.currentPeriodEnd.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("activating an active subscription adds months to its current end", () => {
    const { next } = applySubscriptionChange(active, { type: "activate", months: 3 }, now);
    expect(next.currentPeriodStart).toEqual(active.currentPeriodStart);
    expect(next.currentPeriodEnd.toISOString()).toBe("2027-01-12T00:00:00.000Z");
  });

  it("clamps month-end dates", () => {
    const jan31 = new Date("2026-01-31T00:00:00Z");
    const { next } = applySubscriptionChange({ ...expired, currentPeriodEnd: new Date("2026-01-01T00:00:00Z") }, { type: "activate", months: 1 }, jan31);
    expect(next.currentPeriodEnd.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("extending never shortens and revives an expired subscription", () => {
    expect(applySubscriptionChange(active, { type: "extend", days: 5 }, now).next.currentPeriodEnd).toEqual(days(15));
    const revived = applySubscriptionChange(expired, { type: "extend", days: 7 }, now).next;
    expect(revived).toMatchObject({ status: "ACTIVE", currentPeriodEnd: days(7) });
  });

  it("extending a trial moves the trial end too", () => {
    const { next } = applySubscriptionChange(trial, { type: "extend", days: 7 }, now);
    expect(next).toMatchObject({ status: "TRIALING", currentPeriodEnd: days(16), trialEndsAt: days(16) });
  });

  it("suspend → reactivate returns to the previous state", () => {
    const suspended = applySubscriptionChange(active, { type: "suspend", reason: "Payment dispute" }, now).next;
    expect(suspended.gymStatus).toBe("SUSPENDED");
    const back = applySubscriptionChange(suspended, { type: "reactivate" }, now).next;
    expect(back).toMatchObject({ gymStatus: "ACTIVE", status: "ACTIVE" });
    const trialBack = applySubscriptionChange(applySubscriptionChange(trial, { type: "suspend", reason: "x".repeat(10) }, now).next, { type: "reactivate" }, now).next;
    expect(trialBack.gymStatus).toBe("TRIAL");
  });

  it("cancel makes the subscription cancelled; reactivating after the period ended leaves it expired", () => {
    const cancelled = applySubscriptionChange(expired, { type: "cancel", reason: "Closed down" }, now).next;
    expect(cancelled).toMatchObject({ gymStatus: "CANCELLED", status: "CANCELLED" });
    expect(applySubscriptionChange(cancelled, { type: "reactivate" }, now).next).toMatchObject({ gymStatus: "ACTIVE", status: "EXPIRED" });
  });

  it.each([
    ["activating a suspended gym", { ...active, gymStatus: "SUSPENDED" as const }, { type: "activate" as const, months: 1 }],
    ["activating for 0 months", active, { type: "activate" as const, months: 0 }],
    ["extending by 1000 days", active, { type: "extend" as const, days: 1000 }],
    ["changing to the same plan", active, { type: "changePlan" as const, planId: "pro" }],
    ["suspending twice", { ...active, gymStatus: "SUSPENDED" as const }, { type: "suspend" as const, reason: "again again" }],
    ["reactivating an active gym", active, { type: "reactivate" as const }],
  ])("rejects %s", (_label, state, change) => {
    expect(() => applySubscriptionChange(state, change, now)).toThrow(InvalidSubscriptionChange);
  });
});
