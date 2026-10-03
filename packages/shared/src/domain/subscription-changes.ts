import type { GymStatus, SubscriptionStatus } from "./subscription-access";

/**
 * Manual subscription changes made by a super admin, as pure state transitions.
 * The billing provider persists the result and records SubscriptionHistory.
 */

export type SubscriptionState = {
  gymStatus: GymStatus;
  status: SubscriptionStatus;
  planId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
};

export type SubscriptionChange =
  | { type: "activate"; months: number }
  | { type: "extend"; days: number }
  | { type: "changePlan"; planId: string }
  | { type: "suspend"; reason: string }
  | { type: "reactivate" }
  | { type: "cancel"; reason: string };

export type HistoryAction = "ACTIVATED" | "EXTENDED" | "PLAN_CHANGED" | "SUSPENDED" | "REACTIVATED" | "CANCELLED";

export class InvalidSubscriptionChange extends Error {}

const DAY_MS = 86_400_000;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() < day) d.setUTCDate(0); // clamp e.g. 31 Jan + 1 month → 28/29 Feb
  return d;
}

export function applySubscriptionChange(
  state: SubscriptionState,
  change: SubscriptionChange,
  now: Date = new Date()
): { next: SubscriptionState; action: HistoryAction } {
  const periodActive = state.currentPeriodEnd.getTime() > now.getTime();

  switch (change.type) {
    case "activate": {
      if (!Number.isInteger(change.months) || change.months < 1 || change.months > 36) {
        throw new InvalidSubscriptionChange("Activate for 1 to 36 months.");
      }
      if (state.gymStatus === "CANCELLED" || state.gymStatus === "SUSPENDED") {
        throw new InvalidSubscriptionChange(`Reactivate the ${state.gymStatus.toLowerCase()} gym first.`);
      }
      // A paid activation during a trial or after expiry starts a fresh paid period now.
      const start = state.status === "ACTIVE" && periodActive ? state.currentPeriodStart : now;
      const from = state.status === "ACTIVE" && periodActive ? state.currentPeriodEnd : now;
      return {
        action: "ACTIVATED",
        next: { ...state, gymStatus: "ACTIVE", status: "ACTIVE", currentPeriodStart: start, currentPeriodEnd: addMonths(from, change.months) },
      };
    }
    case "extend": {
      if (!Number.isInteger(change.days) || change.days < 1 || change.days > 365) {
        throw new InvalidSubscriptionChange("Extend by 1 to 365 days.");
      }
      if (state.gymStatus === "CANCELLED") throw new InvalidSubscriptionChange("A cancelled subscription cannot be extended.");
      // Extending never shortens: count from the later of now and the current end.
      const base = Math.max(state.currentPeriodEnd.getTime(), now.getTime());
      const end = new Date(base + change.days * DAY_MS);
      const isTrial = state.status === "TRIALING" || (state.status === "EXPIRED" && state.gymStatus === "TRIAL");
      return {
        action: "EXTENDED",
        next: {
          ...state,
          status: isTrial ? "TRIALING" : state.status === "EXPIRED" ? "ACTIVE" : state.status,
          currentPeriodEnd: end,
          trialEndsAt: isTrial ? end : state.trialEndsAt,
        },
      };
    }
    case "changePlan": {
      if (change.planId === state.planId) throw new InvalidSubscriptionChange("The gym is already on this plan.");
      return { action: "PLAN_CHANGED", next: { ...state, planId: change.planId } };
    }
    case "suspend": {
      if (state.gymStatus === "SUSPENDED") throw new InvalidSubscriptionChange("The gym is already suspended.");
      if (state.gymStatus === "CANCELLED") throw new InvalidSubscriptionChange("A cancelled gym cannot be suspended.");
      return { action: "SUSPENDED", next: { ...state, gymStatus: "SUSPENDED" } };
    }
    case "reactivate": {
      if (state.gymStatus !== "SUSPENDED" && state.gymStatus !== "CANCELLED") {
        throw new InvalidSubscriptionChange("Only suspended or cancelled gyms can be reactivated.");
      }
      const backToTrial = state.status === "TRIALING";
      return {
        action: "REACTIVATED",
        next: {
          ...state,
          gymStatus: backToTrial ? "TRIAL" : "ACTIVE",
          status: state.status === "CANCELLED" ? (periodActive ? "ACTIVE" : "EXPIRED") : state.status,
        },
      };
    }
    case "cancel": {
      if (state.gymStatus === "CANCELLED") throw new InvalidSubscriptionChange("The gym is already cancelled.");
      return { action: "CANCELLED", next: { ...state, gymStatus: "CANCELLED", status: "CANCELLED" } };
    }
  }
}
