/**
 * Live sessions (online PT, live classes) on LiveKit — the rules shared by the server and the
 * apps. See docs/LIVE_SESSIONS.md. The server decides who may join which room and with what
 * rights; LiveKit carries the video.
 */

export type DeliveryMode = "IN_PERSON" | "ONLINE" | "HYBRID";
export type LiveKind = "class" | "pt";

export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  IN_PERSON: "In person",
  ONLINE: "Online",
  HYBRID: "Hybrid (in the room and online)",
};

/** Joining opens this long before the start… */
export const LIVE_OPENS_MINUTES_BEFORE = 10;
/** …and closes this long after the end, when the room is closed for everyone. */
export const LIVE_CLOSES_MINUTES_AFTER = 15;
/** A join token never lives longer than this, whatever the session length. */
export const LIVE_TOKEN_MAX_SECONDS = 3 * 3600;
/** An empty room is closed after this long (LiveKit's emptyTimeout). */
export const LIVE_EMPTY_ROOM_SECONDS = 5 * 60;

export function hasVideoRoom(mode: DeliveryMode): boolean {
  return mode !== "IN_PERSON";
}

export function joinWindow(startsAt: Date, endsAt: Date) {
  return {
    opensAt: new Date(startsAt.getTime() - LIVE_OPENS_MINUTES_BEFORE * 60_000),
    closesAt: new Date(endsAt.getTime() + LIVE_CLOSES_MINUTES_AFTER * 60_000),
  };
}

export type JoinTiming = "too_early" | "open" | "ended";

export function joinTiming(startsAt: Date, endsAt: Date, now = new Date()): JoinTiming {
  const { opensAt, closesAt } = joinWindow(startsAt, endsAt);
  if (now < opensAt) return "too_early";
  if (now >= closesAt) return "ended";
  return "open";
}

/** Seconds a token issued `now` may live: to the window's close, between 1 minute and the cap. */
export function tokenTtlSeconds(endsAt: Date, now = new Date()): number {
  const closesAt = endsAt.getTime() + LIVE_CLOSES_MINUTES_AFTER * 60_000;
  const left = Math.floor((closesAt - now.getTime()) / 1000);
  return Math.max(60, Math.min(LIVE_TOKEN_MAX_SECONDS, left));
}

// ── Room names and identities ──
// Ids are cuid2 (lowercase letters and digits); the pattern is a little wider for test ids, but
// never allows "_" so the separators stay unambiguous.

const ID = "[A-Za-z0-9-]{1,64}";
const ROOM = new RegExp(`^g_(${ID})__(class|pt)_(${ID})$`);
const IDENTITY = new RegExp(`^(m|s)_(${ID})$`);

/** One room per session; the gym is part of the name, so rooms of different gyms never meet. */
export function liveRoomName(gymId: string, kind: LiveKind, sessionId: string): string {
  return `g_${gymId}__${kind}_${sessionId}`;
}

export function parseLiveRoomName(name: string): { gymId: string; kind: LiveKind; sessionId: string } | null {
  const m = ROOM.exec(name);
  return m ? { gymId: m[1], kind: m[2] as LiveKind, sessionId: m[3] } : null;
}

export type LiveParticipant = { memberId: string } | { staffId: string };

/** A person's identity in a room: their member or staff id, never their user id or email. */
export function liveIdentity(p: LiveParticipant): string {
  return "memberId" in p ? `m_${p.memberId}` : `s_${p.staffId}`;
}

export function parseLiveIdentity(identity: string): LiveParticipant | null {
  const m = IDENTITY.exec(identity);
  if (!m) return null;
  return m[1] === "m" ? { memberId: m[2] } : { staffId: m[2] };
}

/** In a class, other members see "Alice S.", not the full name. */
export function classDisplayName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0);
  return initial ? `${firstName.trim()} ${initial.toUpperCase()}.` : firstName.trim();
}

// ── Rights in the room ──

/** host: the class trainer. coach: the PT trainer. member: a booked member or the PT client. */
export type LiveRole = "host" | "coach" | "member";
export type LiveSource = "camera" | "microphone" | "screen_share";

export type LiveGrants = {
  canSubscribe: true;
  canPublish: true;
  sources: LiveSource[];
  /** Mute and remove others (class host only). */
  roomAdmin: boolean;
};

export function liveGrants(role: LiveRole): LiveGrants {
  if (role === "member") return { canSubscribe: true, canPublish: true, sources: ["camera", "microphone"], roomAdmin: false };
  return { canSubscribe: true, canPublish: true, sources: ["camera", "microphone", "screen_share"], roomAdmin: role === "host" };
}

/** Room size: everyone who may be booked, plus the trainer and one spare for a reconnect. */
export function liveMaxParticipants(kind: LiveKind, capacity: number): number {
  return kind === "pt" ? 3 : capacity + 2;
}

/** Why someone can't join, said plainly (used by the server's errors and the apps' hints). */
export const LIVE_JOIN_MESSAGES = {
  notConfigured: "Live sessions aren't set up on this server.",
  notInPlan: "Your gym's plan doesn't include live video sessions.",
  inPerson: "This session takes place in person, not online.",
  cancelled: "This session was cancelled.",
  closed: "This session has finished.",
  tooEarly: `You can join ${LIVE_OPENS_MINUTES_BEFORE} minutes before the start.`,
  ended: "This session has ended.",
  notBooked: "Book this class to join it online.",
  waitlisted: "You're on the waitlist. You can join once you have a place.",
  notYours: "Only the session's trainer and client can join this call.",
  notTrainer: "Only the class's trainer and booked members can join.",
} as const;
