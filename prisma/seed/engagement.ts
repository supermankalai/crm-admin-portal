import type { PrismaClient } from "@/generated/prisma/client";
import { dedupeKey } from "@/domain/notifications";
import { encryptField } from "@/server/crypto";
import { GYMS } from "./config";
import { at, id } from "./lib";

/**
 * Announcements, notification history, push preferences and a deletion request (mobile Phase 6).
 * Deterministic (no faker). Seeded notifications are marked as already handled by the push job,
 * so running jobs:run never pushes old news.
 *
 *   member1@<gym>   has a few read and unread notifications in the app's inbox
 *   member2@<gym>   has class reminders turned off
 *   member19@irontemple.example has asked for their account to be deleted (web: Members → Deletion requests)
 *   member18@pulsefitness.example had a request rejected (they see the gym's note in the app)
 */

const ANNOUNCEMENTS = [
  { daysAgo: 1, audience: "EVERYONE", title: "New opening hours from Monday", body: "We're opening at 5:30 am on weekdays from next Monday. Weekend hours stay the same." },
  { daysAgo: 6, audience: "MEMBERS", title: "Free mobility workshop this Saturday", body: "Join our trainers for a free 45-minute mobility workshop at 10 am in Studio 1. Book it in the app like any class." },
  { daysAgo: 12, audience: "STAFF", title: "Team meeting moved to Thursday", body: "This week's team meeting is on Thursday at 2 pm instead of Wednesday." },
] as const;

export async function seedEngagement(db: PrismaClient) {
  for (const spec of GYMS) {
    const gym = await db.gym.findUniqueOrThrow({ where: { slug: spec.slug }, select: { id: true } });
    const gymId = gym.id;
    const owner = await db.staffMember.findFirstOrThrow({ where: { gymId, role: "OWNER" }, select: { id: true, userId: true } });
    const staff = await db.staffMember.findMany({ where: { gymId, status: "ACTIVE" }, select: { userId: true } });
    const accounts = await db.memberAccount.findMany({ where: { gymId, status: "ACTIVE" }, select: { userId: true, memberId: true, user: { select: { email: true } } } });

    // Announcements, with their inbox copies (already delivered).
    for (const a of ANNOUNCEMENTS) {
      const annId = id();
      const publishedAt = at(-a.daysAgo, 9);
      await db.announcement.create({ data: { id: annId, gymId, title: a.title, body: a.body, audience: a.audience, createdById: owner.id, publishedAt, createdAt: publishedAt } });
      const recipients = new Set<string>();
      if (a.audience !== "STAFF") for (const m of accounts) recipients.add(m.userId);
      if (a.audience !== "MEMBERS") for (const s of staff) if (s.userId !== owner.userId) recipients.add(s.userId);
      await db.notification.createMany({
        data: [...recipients].map((userId, i) => ({
          gymId,
          recipientUserId: userId,
          type: "ANNOUNCEMENT" as const,
          title: a.title,
          body: a.body,
          entityType: "Announcement",
          entityId: annId,
          dedupeKey: dedupeKey("ANNOUNCEMENT", annId, userId),
          createdAt: publishedAt,
          pushedAt: publishedAt,
          readAt: a.daysAgo > 3 && i % 2 === 0 ? at(-a.daysAgo + 1, 8) : null,
        })),
      });
    }

    // Some history in member1's inbox.
    const member1 = accounts.find((a) => a.user.email === `member1@${spec.emailDomain}`);
    if (member1) {
      const history = [
        { type: "CLASS_REMINDER" as const, title: "Class reminder", body: "Yoga Flow starts at 6:30 pm. See you there!", daysAgo: 2, read: true },
        { type: "WAITLIST_PROMOTED" as const, title: "You're in!", body: "A spot opened up in HIIT Blast and you've been booked in.", daysAgo: 4, read: true },
        { type: "PAYMENT_DUE" as const, title: "Payment due soon", body: "An invoice is due in 3 days. See Payments & invoices for details.", daysAgo: 0, read: false },
      ];
      await db.notification.createMany({
        data: history.map((h) => {
          const created = at(-h.daysAgo, 8);
          return {
            gymId,
            recipientUserId: member1.userId,
            type: h.type,
            title: h.title,
            body: h.body,
            dedupeKey: dedupeKey(h.type, `seed:${h.daysAgo}`, member1.userId),
            createdAt: created,
            pushedAt: created,
            readAt: h.read ? at(-h.daysAgo, 9) : null,
          };
        }),
      });
    }

    // member2 has turned class reminders off.
    const member2 = accounts.find((a) => a.user.email === `member2@${spec.emailDomain}`);
    if (member2) await db.notificationPreference.create({ data: { gymId, userId: member2.userId, classReminders: false } });

    // A request Pulse Fitness already rejected (history; also gives every gym rows for the
    // isolation tests).
    const member18 = accounts.find((a) => a.user.email === `member18@${spec.emailDomain}`);
    if (spec.slug === "pulse-fitness" && member18) {
      await db.accountDeletionRequest.create({
        data: { gymId, memberId: member18.memberId, userId: member18.userId, status: "REJECTED", resolvedAt: at(-3, 11), resolvedById: owner.id, resolutionNote: "Please settle your open invoice first.", createdAt: at(-5, 19) },
      });
    }

    // One pending deletion request at Iron Temple.
    const member19 = accounts.find((a) => a.user.email === `member19@${spec.emailDomain}`);
    if (spec.slug === "iron-temple" && member19) {
      const reqId = id();
      await db.accountDeletionRequest.create({
        data: {
          id: reqId,
          gymId,
          memberId: member19.memberId,
          userId: member19.userId,
          reasonEnc: encryptField("Moving to another city.", { gymId, model: "AccountDeletionRequest", field: "reason", recordId: reqId }),
          createdAt: at(-1, 20),
        },
      });
      const managers = await db.staffMember.findMany({ where: { gymId, status: "ACTIVE", role: { in: ["OWNER", "MANAGER"] } }, select: { userId: true } });
      await db.notification.createMany({
        data: managers.map((m) => ({
          gymId,
          recipientUserId: m.userId,
          type: "DELETION_REQUEST" as const,
          title: "Account deletion request",
          body: "A member asked for their app account and personal data to be deleted. Review it under Members → Deletion requests.",
          entityType: "AccountDeletionRequest",
          entityId: reqId,
          dedupeKey: dedupeKey("DELETION_REQUEST", reqId, m.userId),
          createdAt: at(-1, 20),
          pushedAt: at(-1, 20),
        })),
      });
    }
  }
}
