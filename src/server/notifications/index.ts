import "server-only";
import { addDays, diffDays, fromDateString, localDate, toDateString } from "@/domain/dates";
import { formatInvoiceNumber } from "@/domain/billing";
import {
  dedupeKey,
  EXPIRY_WARNING_DAYS,
  expiringText,
  isNearLimit,
  limitText,
  overdueText,
  RECIPIENT_ROLES,
  SUBSCRIPTION_WARNING_DAYS,
  subscriptionText,
  type LimitName,
  type NotificationKind,
} from "@/domain/notifications";
import type { GymRole } from "@/domain/permissions";
import type { Tx } from "@/server/db/context";

/**
 * Alert generation and delivery.
 *
 * generateGymNotifications() finds what needs attention in one gym and hands one message per
 * recipient to every channel. It is idempotent (each message has a dedupe key that is unique
 * per gym), so the scheduled job and on-demand refreshes can both run it safely.
 *
 * It is written against the Prisma API with explicit gymId filters, so it works both inside
 * the app's RLS tenant context and from the jobs script (owner role, which bypasses RLS).
 */

export type OutgoingNotification = {
  gymId: string;
  recipientUserId: string;
  type: NotificationKind;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  dedupeKey: string;
};

/** A delivery channel. Email or SMS channels can be added here alongside in-app. */
export interface NotificationChannel {
  readonly name: string;
  /** Deliver messages; returns how many were new (already-delivered dedupe keys are skipped). */
  send(tx: Tx, messages: OutgoingNotification[]): Promise<number>;
}

export const inAppChannel: NotificationChannel = {
  name: "in-app",
  async send(tx, messages) {
    if (messages.length === 0) return 0;
    // ON CONFLICT (gymId, dedupeKey) DO NOTHING; no RETURNING, so staff may create alerts for
    // colleagues without being able to read them back.
    const result = await tx.notification.createMany({ data: messages, skipDuplicates: true });
    return result.count;
  },
};

export function notificationChannels(): NotificationChannel[] {
  return [inAppChannel];
}

type Subject = { kind: Exclude<NotificationKind, "SYSTEM">; key: string; title: string; body: string; entityType: string | null; entityId: string | null };

export async function generateGymNotifications(tx: Tx, gymId: string, now = new Date()): Promise<{ created: number; subjects: number }> {
  const gym = await tx.gym.findUnique({
    where: { id: gymId },
    select: {
      timezone: true,
      status: true,
      subscription: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true, plan: { select: { name: true, maxMembers: true, maxStaff: true, maxLocations: true } } } },
    },
  });
  if (!gym || gym.status === "SUSPENDED" || gym.status === "CANCELLED") return { created: 0, subjects: 0 };
  const today = localDate(now, gym.timezone);
  const subjects: Subject[] = [];

  // Memberships ending within the warning window that have not been renewed.
  const ending = await tx.membership.findMany({
    where: {
      gymId,
      status: { in: ["ACTIVE", "FROZEN"] },
      cancelledAt: null,
      endDate: { gte: fromDateString(today), lte: fromDateString(addDays(today, EXPIRY_WARNING_DAYS)) },
      member: { deletedAt: null },
    },
    select: { id: true, memberId: true, startDate: true, endDate: true, member: { select: { firstName: true, lastName: true } } },
    orderBy: { endDate: "asc" },
  });
  if (ending.length) {
    const later = await tx.membership.findMany({
      where: { gymId, memberId: { in: ending.map((m) => m.memberId) }, status: { not: "CANCELLED" } },
      select: { memberId: true, startDate: true },
    });
    for (const ms of ending) {
      const renewed = later.some((l) => l.memberId === ms.memberId && l.startDate > ms.startDate);
      if (renewed) continue;
      const text = expiringText(`${ms.member.firstName} ${ms.member.lastName}`, diffDays(today, toDateString(ms.endDate)));
      subjects.push({ kind: "MEMBERSHIP_EXPIRING", key: ms.id, ...text, entityType: "Membership", entityId: ms.id });
    }
  }

  // Open invoices past their due date.
  const overdue = await tx.invoice.findMany({
    where: { gymId, status: "OPEN", deletedAt: null, dueDate: { lt: fromDateString(today) }, member: { deletedAt: null } },
    select: { id: true, number: true, dueDate: true, member: { select: { firstName: true, lastName: true } } },
    orderBy: { dueDate: "asc" },
    take: 200,
  });
  for (const inv of overdue) {
    const text = overdueText(formatInvoiceNumber(inv.number), `${inv.member.firstName} ${inv.member.lastName}`, diffDays(toDateString(inv.dueDate), today));
    subjects.push({ kind: "PAYMENT_OVERDUE", key: inv.id, ...text, entityType: "Invoice", entityId: inv.id });
  }

  // The gym's own platform subscription or trial ending soon.
  const sub = gym.subscription;
  if (sub && (sub.status === "TRIALING" || sub.status === "ACTIVE")) {
    const trial = sub.status === "TRIALING";
    const endsOn = localDate(trial && sub.trialEndsAt ? sub.trialEndsAt : sub.currentPeriodEnd, gym.timezone);
    const daysLeft = diffDays(today, endsOn);
    if (daysLeft >= 0 && daysLeft <= SUBSCRIPTION_WARNING_DAYS) {
      subjects.push({ kind: "SUBSCRIPTION_EXPIRING", key: `${sub.status}:${endsOn}`, ...subscriptionText(sub.plan.name, daysLeft, trial), entityType: "GymSubscription", entityId: null });
    }
  }

  // Plan limits nearly used up (one alert per limit, level and month).
  if (sub) {
    const usage: [LimitName, number, number][] = [
      ["members", await tx.member.count({ where: { gymId, deletedAt: null } }), sub.plan.maxMembers],
      ["staff", await tx.staffMember.count({ where: { gymId, status: "ACTIVE" } }), sub.plan.maxStaff],
      ["locations", await tx.location.count({ where: { gymId, isActive: true } }), sub.plan.maxLocations],
    ];
    for (const [kind, used, max] of usage) {
      if (isNearLimit(used, max)) subjects.push({ kind: "PLAN_LIMIT_NEAR", key: `${kind}:${max}:${today.slice(0, 7)}`, ...limitText(kind, used, max), entityType: "PlatformPlan", entityId: null });
    }
  }

  if (subjects.length === 0) return { created: 0, subjects: 0 };

  const staff = await tx.staffMember.findMany({ where: { gymId, status: "ACTIVE" }, select: { userId: true, role: true } });
  const messages: OutgoingNotification[] = [];
  for (const s of subjects) {
    const roles: readonly GymRole[] = RECIPIENT_ROLES[s.kind];
    for (const person of staff.filter((p) => roles.includes(p.role))) {
      messages.push({
        gymId,
        recipientUserId: person.userId,
        type: s.kind,
        title: s.title,
        body: s.body,
        entityType: s.entityType,
        entityId: s.entityId,
        dedupeKey: dedupeKey(s.kind, s.key, person.userId),
      });
    }
  }

  let created = 0;
  for (const channel of notificationChannels()) {
    const n = await channel.send(tx, messages);
    if (channel === inAppChannel) created = n;
  }
  return { created, subjects: subjects.length };
}

