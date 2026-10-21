import "server-only";
import { DEFAULT_PREFERENCES, PREFERENCE_KEYS, PREFERENCE_LABELS, type PreferenceKey, type Preferences } from "@/domain/notifications";
import type { Tx } from "@/server/db/context";
import { NotFoundError } from "@/server/errors";
import type { GymAuth } from "@/server/mobile/context";
import { before, decodeCursor, page } from "@/server/mobile/cursor";
import { inTenant } from "@/server/tenant/guards";
import { inMember } from "@/server/tenant/member";

/**
 * The mobile inbox, push preferences, push tokens and announcements — for staff and members alike.
 * Each runs in the caller's own database context (staff tenant or member), so RLS decides what
 * they can see: only their own notifications, tokens and preferences; members only the
 * announcements meant for them.
 */

function inGym<T>(auth: GymAuth, fn: (tx: Tx) => Promise<T>) {
  return auth.kind === "staff" ? inTenant(auth.staff, fn) : inMember(auth.member, fn);
}
const gymIdOf = (auth: GymAuth) => (auth.kind === "staff" ? auth.staff.gym.id : auth.member.gym.id);

type Target = "classes" | "membership" | "payments" | "announcements" | "alerts" | "members";

/** Where a notification leads in the app, by who's looking. */
function targetFor(type: string, kind: GymAuth["kind"]): Target | null {
  if (type === "ANNOUNCEMENT") return "announcements";
  if (kind === "member") {
    if (type === "CLASS_REMINDER" || type === "WAITLIST_PROMOTED") return "classes";
    if (type === "MEMBERSHIP_EXPIRING") return "membership";
    if (type === "PAYMENT_DUE") return "payments";
    return null;
  }
  return type === "MEMBERSHIP_EXPIRING" || type === "PAYMENT_OVERDUE" || type === "CLASS_FULL" ? "alerts" : null;
}

/** A live session's "starts soon" alert opens its call. */
function liveFor(type: string, entityType: string | null, entityId: string | null): { kind: "class" | "pt"; sessionId: string } | null {
  if (!entityId) return null;
  if (type === "LIVE_CLASS_STARTING" && entityType === "ClassSession") return { kind: "class", sessionId: entityId };
  if (type === "LIVE_PT_STARTING" && entityType === "TrainingSession") return { kind: "pt", sessionId: entityId };
  return null;
}

export async function listInbox(auth: GymAuth, q: { cursor?: string; limit: number }) {
  const c = decodeCursor(q.cursor);
  const me = auth.user.id;
  return inGym(auth, async (tx) => {
    const [rows, unread] = await Promise.all([
      tx.notification.findMany({
        where: { recipientUserId: me, ...before("createdAt", c) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: q.limit + 1,
        select: { id: true, type: true, title: true, body: true, readAt: true, createdAt: true, entityType: true, entityId: true },
      }),
      tx.notification.count({ where: { recipientUserId: me, readAt: null } }),
    ]);
    const p = page(rows, q.limit, (r) => ({ at: r.createdAt, id: r.id }));
    return {
      unread,
      nextCursor: p.nextCursor,
      items: p.items.map(({ entityType, entityId, ...n }) => ({ ...n, target: targetFor(n.type, auth.kind), live: liveFor(n.type, entityType, entityId), readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })),
    };
  });
}

/** Marking read is allowed even while a gym is read-only: it's the person's own inbox. */
export async function readInboxItem(auth: GymAuth, id: string) {
  const { count } = await inGym(auth, (tx) => tx.notification.updateMany({ where: { id, recipientUserId: auth.user.id, readAt: null }, data: { readAt: new Date() } }));
  if (!count) {
    const exists = await inGym(auth, (tx) => tx.notification.count({ where: { id, recipientUserId: auth.user.id } }));
    if (!exists) throw new NotFoundError("Notification not found.");
  }
  return { ok: true as const };
}

export async function readAllInbox(auth: GymAuth) {
  const r = await inGym(auth, (tx) => tx.notification.updateMany({ where: { recipientUserId: auth.user.id, readAt: null }, data: { readAt: new Date() } }));
  return { marked: r.count };
}

// ─────────────────────────────── Preferences ───────────────────────────────

/**
 * Members see member categories; staff see staff alerts (plus announcements for everyone).
 * Personal training alerts only reach members, trainers and managers, so front desk don't get the switch.
 */
function availableFor(auth: GymAuth): PreferenceKey[] {
  const who = auth.kind === "member" ? "member" : "staff";
  return PREFERENCE_KEYS.filter((k) => {
    if (k === "training" && auth.kind === "staff" && auth.staff.role === "FRONT_DESK") return false;
    return PREFERENCE_LABELS[k].for === "both" || PREFERENCE_LABELS[k].for === who;
  });
}

function pick(row: Preferences | null): Preferences {
  return row ? (Object.fromEntries(PREFERENCE_KEYS.map((k) => [k, row[k]])) as Preferences) : { ...DEFAULT_PREFERENCES };
}

export async function getPreferences(auth: GymAuth) {
  const row = await inGym(auth, (tx) => tx.notificationPreference.findFirst({ where: { userId: auth.user.id } }));
  return { preferences: pick(row), available: availableFor(auth) };
}

export async function updatePreferences(auth: GymAuth, changes: Partial<Preferences>) {
  const allowed = availableFor(auth);
  const data = Object.fromEntries(Object.entries(changes).filter(([k, v]) => allowed.includes(k as PreferenceKey) && typeof v === "boolean"));
  const gymId = gymIdOf(auth);
  const row = await inGym(auth, (tx) =>
    tx.notificationPreference.upsert({ where: { gymId_userId: { gymId, userId: auth.user.id } }, create: { gymId, userId: auth.user.id, ...data }, update: data })
  );
  return { preferences: pick(row), available: allowed };
}

// ─────────────────────────────── Push tokens ───────────────────────────────

/** One token per device per gym: registering again (new token, or after reinstall) replaces it. */
export async function registerPushToken(auth: GymAuth, input: { token: string; platform: "ios" | "android"; provider: "expo" | "fcm" }) {
  const gymId = gymIdOf(auth);
  await inGym(auth, (tx) =>
    tx.pushToken.upsert({
      where: { gymId_deviceSessionId: { gymId, deviceSessionId: auth.sessionId } },
      create: { gymId, userId: auth.user.id, deviceSessionId: auth.sessionId, token: input.token, platform: input.platform, provider: input.provider },
      update: { token: input.token, platform: input.platform, provider: input.provider, invalidatedAt: null },
      select: { id: true },
    })
  );
  return { ok: true as const };
}

export async function removePushToken(auth: GymAuth) {
  // This gym only; signing out removes the device's tokens for every gym.
  await inGym(auth, (tx) => tx.pushToken.deleteMany({ where: { gymId: gymIdOf(auth), userId: auth.user.id, deviceSessionId: auth.sessionId } }));
  return { ok: true as const };
}

// ─────────────────────────────── Announcements ───────────────────────────────

export async function listAnnouncements(auth: GymAuth) {
  const rows = await inGym(auth, (tx) =>
    tx.announcement.findMany({ where: { publishedAt: { lte: new Date() } }, orderBy: { publishedAt: "desc" }, take: 50, select: { id: true, title: true, body: true, audience: true, publishedAt: true } })
  );
  return { items: rows.map((a) => ({ ...a, publishedAt: a.publishedAt.toISOString() })) };
}
