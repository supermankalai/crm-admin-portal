import "server-only";
import { addDays, diffDays, formatDate, formatDateTime, fromDateString, localDate, toDateString } from "@/domain/dates";
import { formatInvoiceNumber } from "@/domain/billing";
import {
  CLASS_REMINDER_MINUTES,
  classFullText,
  classReminderText,
  dedupeKey,
  EXPIRY_WARNING_DAYS,
  expiringText,
  isNearLimit,
  limitText,
  memberExpiringText,
  overdueText,
  PAYMENT_DUE_WARNING_DAYS,
  paymentDueText,
  RECIPIENT_ROLES,
  SUBSCRIPTION_WARNING_DAYS,
  subscriptionText,
  type LimitName,
  type NotificationKind,
  type StaffAlertKind,
} from "@/domain/notifications";
import type { GymRole } from "@/domain/permissions";
import type { Tx } from "@/server/db/context";

/**
 * Alert generation and delivery.
 *
 * generateGymNotifications() finds what needs attention in one gym: alerts for staff (by role) and
 * reminders for members with the member app (class reminders, membership ending, payment due).
 * It is idempotent — each message has a dedupe key that is unique per gym — so the scheduled job
 * and on-demand refreshes can both run it safely.
 *
 * Messages land in the in-app inbox (Notification). Push alerts are sent from those rows by the
 * push job (src/server/push), with generic lock-screen text and the recipient's preferences.
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

/** A delivery channel. Push is delivered from the inbox rows by the push job. */
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
    // colleagues (and members) without being able to read them back.
    const result = await tx.notification.createMany({ data: messages, skipDuplicates: true });
    return result.count;
  },
};

export function notificationChannels(): NotificationChannel[] {
  return [inAppChannel];
}

type Subject = { kind: StaffAlertKind; key: string; title: string; body: string; entityType: string | null; entityId: string | null };

const timeIn = (instant: Date, timeZone: string) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone }).format(instant);

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
  const direct: OutgoingNotification[] = [];

  // Member-app users, by member: only they get member reminders.
  const accounts = new Map(
    (await tx.memberAccount.findMany({ where: { gymId, status: "ACTIVE", member: { deletedAt: null } }, select: { memberId: true, userId: true } })).map((a) => [a.memberId, a.userId])
  );
  const toMember = (memberId: string, kind: NotificationKind, key: string, text: { title: string; body: string }, entityType: string, entityId: string) => {
    const userId = accounts.get(memberId);
    if (userId) direct.push({ gymId, recipientUserId: userId, type: kind, ...text, entityType, entityId, dedupeKey: dedupeKey(kind, `member:${key}`, userId) });
  };

  // Memberships ending within the warning window that have not been renewed.
  const ending = await tx.membership.findMany({
    where: {
      gymId,
      status: { in: ["ACTIVE", "FROZEN"] },
      cancelledAt: null,
      endDate: { gte: fromDateString(today), lte: fromDateString(addDays(today, EXPIRY_WARNING_DAYS)) },
      member: { deletedAt: null },
    },
    select: { id: true, memberId: true, startDate: true, endDate: true, plan: { select: { name: true } }, member: { select: { firstName: true, lastName: true } } },
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
      const endsOn = toDateString(ms.endDate);
      const daysLeft = diffDays(today, endsOn);
      const text = expiringText(`${ms.member.firstName} ${ms.member.lastName}`, daysLeft);
      subjects.push({ kind: "MEMBERSHIP_EXPIRING", key: ms.id, ...text, entityType: "Membership", entityId: ms.id });
      toMember(ms.memberId, "MEMBERSHIP_EXPIRING", ms.id, memberExpiringText(ms.plan.name, formatDate(endsOn), daysLeft), "Membership", ms.id);
    }
  }

  // Open invoices past their due date (staff), and due soon or overdue (the member).
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
  if (accounts.size) {
    const due = await tx.invoice.findMany({
      where: { gymId, status: "OPEN", deletedAt: null, dueDate: { lte: fromDateString(addDays(today, PAYMENT_DUE_WARNING_DAYS)) }, memberId: { in: [...accounts.keys()] } },
      select: { id: true, number: true, dueDate: true, memberId: true },
      orderBy: { dueDate: "asc" },
      take: 500,
    });
    for (const inv of due) {
      const dueOn = toDateString(inv.dueDate);
      const isOverdue = dueOn < today;
      toMember(inv.memberId, "PAYMENT_DUE", `${isOverdue ? "overdue" : "due"}:${inv.id}`, paymentDueText(formatInvoiceNumber(inv.number), formatDate(dueOn), isOverdue), "Invoice", inv.id);
    }

    // Class reminders, a couple of hours before a booked class.
    const soon = await tx.booking.findMany({
      where: {
        gymId,
        status: "BOOKED",
        memberId: { in: [...accounts.keys()] },
        session: { status: "SCHEDULED", startsAt: { gt: now, lte: new Date(now.getTime() + CLASS_REMINDER_MINUTES * 60_000) } },
      },
      select: { id: true, memberId: true, session: { select: { startsAt: true, classType: { select: { name: true } } } } },
      take: 1000,
    });
    for (const b of soon) {
      toMember(b.memberId, "CLASS_REMINDER", b.id, classReminderText(b.session.classType.name, timeIn(b.session.startsAt, gym.timezone)), "Booking", b.id);
    }
  }

  // Classes in the next 24 hours that are fully booked.
  const upcoming = await tx.classSession.findMany({
    where: { gymId, status: "SCHEDULED", startsAt: { gt: now, lte: new Date(now.getTime() + 24 * 3_600_000) } },
    select: { id: true, startsAt: true, capacity: true, classType: { select: { name: true } }, _count: { select: { bookings: { where: { status: "BOOKED" } } } } },
  });
  for (const s of upcoming) {
    if (s._count.bookings >= s.capacity) {
      subjects.push({ kind: "CLASS_FULL", key: s.id, ...classFullText(s.classType.name, formatDateTime(s.startsAt, gym.timezone)), entityType: "ClassSession", entityId: s.id });
    }
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

  if (subjects.length === 0 && direct.length === 0) return { created: 0, subjects: 0 };

  const staff = subjects.length ? await tx.staffMember.findMany({ where: { gymId, status: "ACTIVE" }, select: { userId: true, role: true } }) : [];
  const messages: OutgoingNotification[] = [...direct];
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
  return { created, subjects: subjects.length + direct.length };
}
