import type { GymRole } from "./permissions";

/**
 * Which alerts exist, who receives them, and how they are worded. Generation is idempotent:
 * every alert has a dedupe key per recipient, so running the job again never repeats one.
 */

export type NotificationKind = "MEMBERSHIP_EXPIRING" | "PAYMENT_OVERDUE" | "PLAN_LIMIT_NEAR" | "SUBSCRIPTION_EXPIRING" | "SYSTEM";

export const EXPIRY_WARNING_DAYS = 7;
export const SUBSCRIPTION_WARNING_DAYS = 7;
/** Warn when a plan limit is this full (percent). */
export const PLAN_LIMIT_WARNING_PERCENT = 90;

export const RECIPIENT_ROLES: Record<Exclude<NotificationKind, "SYSTEM">, readonly GymRole[]> = {
  MEMBERSHIP_EXPIRING: ["OWNER", "MANAGER", "FRONT_DESK"],
  PAYMENT_OVERDUE: ["OWNER", "MANAGER"],
  PLAN_LIMIT_NEAR: ["OWNER"],
  SUBSCRIPTION_EXPIRING: ["OWNER"],
};

export function dedupeKey(kind: NotificationKind, subject: string, recipientUserId: string): string {
  return `${kind.toLowerCase()}:${subject}:${recipientUserId}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function expiringText(memberName: string, daysLeft: number) {
  return {
    title: "Membership expiring soon",
    body: daysLeft <= 0 ? `${memberName}'s membership ends today.` : `${memberName}'s membership ends in ${plural(daysLeft, "day")}.`,
  };
}

export function overdueText(invoiceNumber: string, memberName: string, daysOverdue: number) {
  return { title: "Payment overdue", body: `Invoice ${invoiceNumber} for ${memberName} is ${plural(daysOverdue, "day")} overdue.` };
}

export function subscriptionText(planName: string, daysLeft: number, trial: boolean) {
  const what = trial ? "Your free trial" : `Your ${planName} subscription`;
  return {
    title: trial ? "Trial ending soon" : "Subscription renewal due",
    body: daysLeft <= 0 ? `${what} ends today. Renew to keep full access.` : `${what} ends in ${plural(daysLeft, "day")}. Renew to keep full access.`,
  };
}

export type LimitName = "members" | "staff" | "locations";

export function isNearLimit(used: number, max: number): boolean {
  return max > 0 && used * 100 >= max * PLAN_LIMIT_WARNING_PERCENT;
}

export function limitText(kind: LimitName, used: number, max: number) {
  return { title: "Plan limit almost reached", body: `You're using ${used} of ${max} ${kind} on your plan. Upgrade before you run out.` };
}
