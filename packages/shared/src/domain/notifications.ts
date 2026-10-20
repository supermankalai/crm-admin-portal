import type { GymRole } from "./permissions";

/**
 * Which alerts exist, who receives them, and how they are worded. Generation is idempotent:
 * every alert has a dedupe key per recipient, so running the job again never repeats one.
 */

export type NotificationKind =
  | "MEMBERSHIP_EXPIRING"
  | "PAYMENT_OVERDUE"
  | "PLAN_LIMIT_NEAR"
  | "SUBSCRIPTION_EXPIRING"
  | "SYSTEM"
  | "CLASS_REMINDER"
  | "WAITLIST_PROMOTED"
  | "PAYMENT_DUE"
  | "ANNOUNCEMENT"
  | "CLASS_FULL"
  | "DELETION_REQUEST"
  | "PT_ASSIGNED"
  | "PT_ENDED"
  | "PT_SESSION_BOOKED"
  | "PT_SESSION_CANCELLED"
  | "PT_SESSION_REMINDER"
  | "PT_CREDITS_LOW"
  | "PT_PACKAGE_EXPIRING";

/** Personal training alerts: sent to the member and their trainer (switched by "training"). */
export const PT_KINDS: readonly NotificationKind[] = ["PT_ASSIGNED", "PT_ENDED", "PT_SESSION_BOOKED", "PT_SESSION_CANCELLED", "PT_SESSION_REMINDER", "PT_CREDITS_LOW", "PT_PACKAGE_EXPIRING"];

/** Alerts sent to staff by role (the rest go to a specific member, or everyone for announcements). */
export type StaffAlertKind = "MEMBERSHIP_EXPIRING" | "PAYMENT_OVERDUE" | "PLAN_LIMIT_NEAR" | "SUBSCRIPTION_EXPIRING" | "CLASS_FULL";

export const EXPIRY_WARNING_DAYS = 7;
export const SUBSCRIPTION_WARNING_DAYS = 7;
/** Warn when a plan limit is this full (percent). */
export const PLAN_LIMIT_WARNING_PERCENT = 90;

export const RECIPIENT_ROLES: Record<StaffAlertKind, readonly GymRole[]> = {
  MEMBERSHIP_EXPIRING: ["OWNER", "MANAGER", "FRONT_DESK"],
  PAYMENT_OVERDUE: ["OWNER", "MANAGER"],
  PLAN_LIMIT_NEAR: ["OWNER"],
  SUBSCRIPTION_EXPIRING: ["OWNER"],
  CLASS_FULL: ["OWNER", "MANAGER", "FRONT_DESK"],
};

/** Members are reminded this long before a class they booked. */
export const CLASS_REMINDER_MINUTES = 120;
/** Members are reminded of an invoice this many days before it's due (and again once overdue). */
export const PAYMENT_DUE_WARNING_DAYS = 3;

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

export function classFullText(className: string, when: string) {
  return { title: "Class is full", body: `${className} (${when}) is fully booked.` };
}

export function deletionRequestText() {
  return { title: "Account deletion request", body: "A member asked for their app account and personal data to be deleted. Review it under Members → Deletion requests." };
}

// ─────────────────────────────── Member-facing (in the app's inbox) ───────────────────────────────

export function classReminderText(className: string, time: string) {
  return { title: "Class reminder", body: `${className} starts at ${time}. See you there!` };
}

export function waitlistPromotedText(className: string, when: string) {
  return { title: "You're in!", body: `A spot opened up in ${className} (${when}) and you've been booked in.` };
}

export function memberExpiringText(planName: string, endsOn: string, daysLeft: number) {
  return {
    title: "Your membership ends soon",
    body: daysLeft <= 0 ? `Your ${planName} membership ends today. Renew at the front desk to keep training.` : `Your ${planName} membership ends on ${endsOn}. Renew at the front desk to keep training.`,
  };
}

export function paymentDueText(invoiceNumber: string, dueOn: string, overdue: boolean) {
  return overdue
    ? { title: "Payment overdue", body: `Invoice ${invoiceNumber} was due on ${dueOn}. Please pay at the front desk.` }
    : { title: "Payment due soon", body: `Invoice ${invoiceNumber} is due on ${dueOn}.` };
}

// ─────────────────────────────── Preferences and push ───────────────────────────────

export const PREFERENCE_KEYS = ["classReminders", "waitlist", "membership", "payments", "announcements", "staffAlerts", "training"] as const;
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];
export type Preferences = Record<PreferenceKey, boolean>;
export const DEFAULT_PREFERENCES: Preferences = { classReminders: true, waitlist: true, membership: true, payments: true, announcements: true, staffAlerts: true, training: true };

export const PREFERENCE_LABELS: Record<PreferenceKey, { label: string; description: string; for: "member" | "staff" | "both" }> = {
  classReminders: { label: "Class reminders", description: "Before a class you booked", for: "member" },
  waitlist: { label: "Waitlist", description: "When a spot opens and you're booked in", for: "member" },
  membership: { label: "Membership", description: "When your membership is about to end", for: "member" },
  payments: { label: "Payments", description: "When a payment is due or overdue", for: "member" },
  announcements: { label: "Announcements", description: "News from your gym", for: "both" },
  staffAlerts: { label: "Gym alerts", description: "Expiring memberships, overdue payments, full classes", for: "staff" },
  training: { label: "Personal training", description: "Your trainer, PT sessions and reminders, package credits", for: "both" },
};

export type Recipient = "member" | "staff";

/** Which preference switches a notification's push alert. */
export function preferenceFor(kind: NotificationKind, recipient: Recipient): PreferenceKey {
  if (kind === "ANNOUNCEMENT") return "announcements";
  if (PT_KINDS.includes(kind)) return "training";
  if (recipient === "staff") return "staffAlerts";
  switch (kind) {
    case "CLASS_REMINDER":
      return "classReminders";
    case "WAITLIST_PROMOTED":
      return "waitlist";
    case "PAYMENT_DUE":
    case "PAYMENT_OVERDUE":
      return "payments";
    default:
      return "membership";
  }
}

/**
 * The words on a lock screen. Push text is deliberately generic: no names, amounts, invoice
 * numbers, class names, measurements or anything else personal — anyone can read a lock screen.
 * Details are in the app's inbox, behind sign-in. The only free text is an announcement's title,
 * which staff write for the whole gym (and are told not to put personal data in).
 */
export function pushText(kind: NotificationKind, recipient: Recipient, gymName: string, announcementTitle?: string): { title: string; body: string } {
  const body = (() => {
    if (kind === "ANNOUNCEMENT") return announcementTitle ? `New announcement: ${truncate(announcementTitle, 80)}` : "New announcement from your gym.";
    if (recipient === "member") {
      switch (kind) {
        case "CLASS_REMINDER":
          return "Your class starts soon. Open the app for details.";
        case "WAITLIST_PROMOTED":
          return "A spot opened up and you've been booked into your class.";
        case "MEMBERSHIP_EXPIRING":
          return "Your membership ends soon. Renew to keep training.";
        case "PAYMENT_DUE":
          return "You have a payment due. Open the app for details.";
        case "PT_ASSIGNED":
          return "You have a new personal trainer. Open the app to see who.";
        case "PT_ENDED":
          return "There's a change to your personal training.";
        case "PT_SESSION_BOOKED":
          return "A personal training session was booked for you.";
        case "PT_SESSION_CANCELLED":
          return "A personal training session was cancelled.";
        case "PT_SESSION_REMINDER":
          return "Your personal training session starts soon.";
        case "PT_CREDITS_LOW":
          return "Your PT package is running low.";
        case "PT_PACKAGE_EXPIRING":
          return "Some of your PT sessions expire soon.";
        default:
          return "You have a new notification.";
      }
    }
    switch (kind) {
      case "MEMBERSHIP_EXPIRING":
        return "Some memberships end soon. Open FitCRM to see who.";
      case "PAYMENT_OVERDUE":
        return "There are overdue payments. Open FitCRM for details.";
      case "CLASS_FULL":
        return "A class is fully booked.";
      case "DELETION_REQUEST":
        return "A member asked to delete their account.";
      case "PT_ASSIGNED":
        return "You have a new PT client.";
      case "PT_ENDED":
        return "A PT client was removed from your list.";
      case "PT_SESSION_BOOKED":
        return "A PT session was added to your schedule.";
      case "PT_SESSION_CANCELLED":
        return "A PT session on your schedule was cancelled.";
      case "PT_SESSION_REMINDER":
        return "You have a PT session soon.";
      case "PT_CREDITS_LOW":
        return "A client's PT package is running low.";
      default:
        return "Open FitCRM for details.";
    }
  })();
  return { title: gymName, body };
}

function truncate(text: string, max: number) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
