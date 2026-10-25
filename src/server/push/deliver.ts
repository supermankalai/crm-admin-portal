import "server-only";
import { DEFAULT_PREFERENCES, preferenceFor, pushText, type NotificationKind, type Preferences, type Recipient } from "@/domain/notifications";
import type { OwnerClient as DbClient } from "@/server/db/owner";
import { EXPO_TOKEN, RECEIPT_BATCH, SEND_BATCH, type PushMessage, type PushProvider } from "./provider";

/**
 * The push job. Runs in the jobs process as the database owner (it needs everyone's tokens, which
 * the app role can't read), never inside a web request.
 *
 * deliverPendingPushes(): for each new inbox notification, check the recipient is still part of
 * the gym, check their preferences, find their live devices for that gym, and send generic
 * lock-screen text (domain pushText — never names, amounts or other personal details). Every
 * notification is then marked handled, so nothing is pushed twice. Old unsent ones are skipped.
 *
 * checkPushReceipts(): Expo reports per-device delivery a while later. A device that's no longer
 * registered (app removed, token rotated) gets its token invalidated, so we stop sending to it.
 */

/** Notifications older than this when the job sees them are not pushed (stale news). */
export const PUSH_MAX_AGE_MS = 6 * 3_600_000;
/** Expo asks to wait before fetching receipts. */
export const RECEIPT_DELAY_MS = 15 * 60_000;
/** Devices idle longer than the refresh-token lifetime are signed out in practice. */
export const DEVICE_IDLE_MS = 30 * 86_400_000;

type Pending = { id: string; gymId: string; recipientUserId: string; type: NotificationKind; entityType: string | null; entityId: string | null };

export async function deliverPendingPushes(db: DbClient, provider: PushProvider, now = new Date()) {
  const stale = await db.notification.updateMany({ where: { pushedAt: null, createdAt: { lt: new Date(now.getTime() - PUSH_MAX_AGE_MS) } }, data: { pushedAt: now } });
  const pending: Pending[] = await db.notification.findMany({
    where: { pushedAt: null },
    orderBy: { createdAt: "asc" },
    take: 1000,
    select: { id: true, gymId: true, recipientUserId: true, type: true, entityType: true, entityId: true },
  });
  if (!pending.length) return { considered: 0, sent: 0, skipped: 0, stale: stale.count };

  const gymIds = [...new Set(pending.map((n) => n.gymId))];
  const userIds = [...new Set(pending.map((n) => n.recipientUserId))];
  const [gyms, staff, members, prefs, tokens, announcements] = await Promise.all([
    db.gym.findMany({
      where: { id: { in: gymIds } },
      select: { id: true, name: true, slug: true, status: true, subscription: { select: { plan: { select: { featureMobileApp: true, featureMemberApp: true } } } } },
    }),
    db.staffMember.findMany({ where: { gymId: { in: gymIds }, userId: { in: userIds }, status: "ACTIVE" }, select: { gymId: true, userId: true } }),
    db.memberAccount.findMany({ where: { gymId: { in: gymIds }, userId: { in: userIds }, status: "ACTIVE", member: { deletedAt: null } }, select: { gymId: true, userId: true } }),
    db.notificationPreference.findMany({ where: { gymId: { in: gymIds }, userId: { in: userIds } } }),
    db.pushToken.findMany({
      // A device that hasn't refreshed in 30 days can't be signed in any more (refresh tokens expire).
      where: { gymId: { in: gymIds }, userId: { in: userIds }, invalidatedAt: null, deviceSession: { revokedAt: null, lastSeenAt: { gte: new Date(now.getTime() - DEVICE_IDLE_MS) } } },
      select: { id: true, gymId: true, userId: true, token: true, updatedAt: true },
    }),
    db.announcement.findMany({ where: { id: { in: pending.filter((n) => n.type === "ANNOUNCEMENT" && n.entityId).map((n) => n.entityId!) } }, select: { id: true, title: true } }),
  ]);
  const key = (gymId: string, userId: string) => `${gymId}|${userId}`;
  const gymById = new Map(gyms.map((g) => [g.id, g]));
  const staffSet = new Set(staff.map((s) => key(s.gymId, s.userId)));
  const memberSet = new Set(members.map((m) => key(m.gymId, m.userId)));
  const prefBy = new Map(prefs.map((p) => [key(p.gymId, p.userId), p as unknown as Preferences]));
  // One phone, two people (e.g. reinstalled without signing out): only the latest registration counts.
  const newestByToken = new Map<string, (typeof tokens)[number]>();
  for (const t of tokens) {
    const seen = newestByToken.get(t.token);
    if (!seen || t.updatedAt > seen.updatedAt) newestByToken.set(t.token, t);
  }
  const tokensBy = new Map<string, typeof tokens>();
  for (const t of newestByToken.values()) tokensBy.set(key(t.gymId, t.userId), [...(tokensBy.get(key(t.gymId, t.userId)) ?? []), t]);
  const titleBy = new Map(announcements.map((a) => [a.id, a.title]));

  const outgoing: { notificationId: string; pushTokenId: string; message: PushMessage }[] = [];
  let skipped = 0;
  for (const n of pending) {
    const gym = gymById.get(n.gymId);
    const k = key(n.gymId, n.recipientUserId);
    const recipient: Recipient | null = staffSet.has(k) ? "staff" : memberSet.has(k) ? "member" : null;
    const devices = (tokensBy.get(k) ?? []).filter((t) => EXPO_TOKEN.test(t.token));
    const prefs = prefBy.get(k) ?? DEFAULT_PREFERENCES;
    const plan = gym?.subscription?.plan;
    const appInPlan = recipient === "staff" ? plan?.featureMobileApp : plan?.featureMemberApp;
    if (!gym || gym.status === "SUSPENDED" || gym.status === "CANCELLED" || !recipient || !appInPlan || !devices.length || !prefs[preferenceFor(n.type, recipient)]) {
      skipped++;
      continue;
    }
    const text = pushText(n.type, recipient, gym.name, n.entityId ? titleBy.get(n.entityId) : undefined);
    for (const d of devices) {
      outgoing.push({ notificationId: n.id, pushTokenId: d.id, message: { to: d.token, ...text, data: { notificationId: n.id, type: n.type, gymSlug: gym.slug } } });
    }
  }

  let sent = 0;
  for (let i = 0; i < outgoing.length; i += SEND_BATCH) {
    const batch = outgoing.slice(i, i + SEND_BATCH);
    const tickets = await provider.send(batch.map((b) => b.message));
    const deliveries = batch.map((b, j) => {
      const t = tickets[j] ?? { status: "error" as const, error: "NoTicket" };
      return { notificationId: b.notificationId, pushTokenId: b.pushTokenId, ticketId: t.status === "ok" ? t.id : null, status: t.status === "ok" ? "SENT" : "ERROR", error: t.status === "ok" ? null : t.error };
    });
    await db.pushDelivery.createMany({ data: deliveries, skipDuplicates: true });
    const gone = deliveries.filter((d) => d.error === "DeviceNotRegistered").map((d) => d.pushTokenId);
    if (gone.length) await db.pushToken.updateMany({ where: { id: { in: gone } }, data: { invalidatedAt: now } });
    sent += deliveries.filter((d) => d.status === "SENT").length;
  }
  // Handled: sent, or nothing to send (no device, turned off, not in the gym any more).
  await db.notification.updateMany({ where: { id: { in: pending.map((n) => n.id) } }, data: { pushedAt: now } });
  return { considered: pending.length, sent, skipped, stale: stale.count };
}

export async function checkPushReceipts(db: DbClient, provider: PushProvider, now = new Date()) {
  const waiting = await db.pushDelivery.findMany({
    where: { status: "SENT", ticketId: { not: null }, receiptCheckedAt: null, createdAt: { lte: new Date(now.getTime() - RECEIPT_DELAY_MS), gte: new Date(now.getTime() - 24 * 3_600_000) } },
    take: 3000,
    select: { id: true, ticketId: true, pushTokenId: true },
  });
  let invalidated = 0;
  for (let i = 0; i < waiting.length; i += RECEIPT_BATCH) {
    const batch = waiting.slice(i, i + RECEIPT_BATCH);
    const receipts = await provider.receipts(batch.map((d) => d.ticketId!));
    for (const d of batch) {
      const r = receipts[d.ticketId!];
      if (!r) continue; // not ready yet: try again next run
      await db.pushDelivery.update({ where: { id: d.id }, data: { status: r.status === "ok" ? "DELIVERED" : "ERROR", error: r.status === "ok" ? null : r.error, receiptCheckedAt: now } });
      if (r.status === "error" && r.error === "DeviceNotRegistered") {
        invalidated += (await db.pushToken.updateMany({ where: { id: d.pushTokenId, invalidatedAt: null }, data: { invalidatedAt: now } })).count;
      }
    }
  }
  // Housekeeping: old delivery records and long-dead tokens.
  const month = new Date(now.getTime() - 30 * 86_400_000);
  await db.pushDelivery.deleteMany({ where: { createdAt: { lt: month } } });
  await db.pushToken.deleteMany({ where: { invalidatedAt: { lt: month } } });
  return { checked: waiting.length, invalidated };
}
