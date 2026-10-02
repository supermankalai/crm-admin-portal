/**
 * Whether a gym may change data, derived from its status and subscription dates at request
 * time (so it is correct even if the expiry job has not run). Read access is never removed:
 * data is kept and visible, the gym just becomes read-only with a banner.
 */

export type GymStatus = "TRIAL" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "EXPIRED" | "CANCELLED";

export type ReadOnlyReason = "trial_ended" | "subscription_expired" | "suspended" | "cancelled" | "no_subscription";

export type SubscriptionAccess = {
  writable: boolean;
  reason: ReadOnlyReason | null;
  isTrial: boolean;
  /** End of the trial or the paid period. */
  endsAt: Date | null;
  /** Days left, rounded up (a trial that just started shows its full length); <= 0 once expired. */
  daysRemaining: number | null;
};

const DAY_MS = 86_400_000;

export function computeSubscriptionAccess(
  gymStatus: GymStatus,
  subscription: { status: SubscriptionStatus; currentPeriodEnd: Date; trialEndsAt: Date | null } | null,
  now: Date = new Date()
): SubscriptionAccess {
  if (!subscription) {
    return { writable: false, reason: "no_subscription", isTrial: false, endsAt: null, daysRemaining: null };
  }
  const isTrial = gymStatus === "TRIAL" || subscription.status === "TRIALING";
  const endsAt = isTrial && subscription.trialEndsAt ? subscription.trialEndsAt : subscription.currentPeriodEnd;
  const daysRemaining = Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS);
  const base = { isTrial, endsAt, daysRemaining };

  if (gymStatus === "SUSPENDED") return { ...base, writable: false, reason: "suspended" };
  if (gymStatus === "CANCELLED" || subscription.status === "CANCELLED") return { ...base, writable: false, reason: "cancelled" };
  if (subscription.status === "EXPIRED" || now.getTime() >= endsAt.getTime()) {
    return { ...base, writable: false, reason: isTrial ? "trial_ended" : "subscription_expired" };
  }
  return { ...base, writable: true, reason: null };
}

export const READ_ONLY_MESSAGES: Record<ReadOnlyReason, string> = {
  trial_ended: "Your free trial has ended. Your data is safe, but the gym is read-only until a plan is activated.",
  subscription_expired: "Your subscription has expired. Your data is safe, but the gym is read-only until it is renewed.",
  suspended: "This gym has been suspended by the platform. Your data is safe, but the gym is read-only. Contact support.",
  cancelled: "This gym's subscription was cancelled. Your data is kept, but the gym is read-only.",
  no_subscription: "This gym has no active subscription, so it is read-only.",
};
