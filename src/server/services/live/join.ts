import "server-only";
import { AccessToken, RoomConfiguration, TrackSource } from "livekit-server-sdk";
import {
  classDisplayName,
  hasVideoRoom,
  joinTiming,
  LIVE_EMPTY_ROOM_SECONDS,
  LIVE_JOIN_MESSAGES as M,
  liveGrants,
  liveIdentity,
  liveMaxParticipants,
  liveRoomName,
  parseLiveIdentity,
  tokenTtlSeconds,
  type DeliveryMode,
  type LiveKind,
  type LiveParticipant,
  type LiveRole,
  type LiveSource,
} from "@/domain/live";
import { READ_ONLY_MESSAGES, type SubscriptionAccess } from "@/domain/subscription-access";
import type { Tx } from "@/server/db/context";
import { AppError, FeatureNotInPlanError, ForbiddenError, GymReadOnlyError, NotFoundError } from "@/server/errors";
import { enforce, RATE_LIMITS } from "@/server/security/rate-limit";
import { inMember, type MemberContext } from "@/server/tenant/member";
import { inTenant } from "@/server/tenant/guards";
import type { PlanSummary, TenantContext } from "@/server/tenant/types";
import { liveKitConfig, type LiveKitConfig } from "./config";
import { liveRoomAdmin } from "./rooms";

/**
 * Joining a live session: check that this person may be in this session's room right now, then
 * sign a LiveKit token for that room only. The token carries the room's settings (size, empty
 * timeout), so LiveKit creates the room on the first join and this needs no call to the server.
 *
 * Who may join (docs/LIVE_SESSIONS.md): the session's trainer, a member with a place in the
 * class, or the PT session's client. Nobody else, managers included.
 */

export type LiveJoin = {
  url: string;
  token: string;
  roomName: string;
  identity: string;
  role: LiveRole;
  expiresAt: Date;
  session: { kind: LiveKind; id: string; title: string; startsAt: Date; endsAt: Date; deliveryMode: DeliveryMode };
};

type Session = {
  kind: LiveKind;
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  deliveryMode: DeliveryMode;
  capacity: number;
  trainerId: string;
  /** The PT client (PT sessions only). */
  memberId: string | null;
};

const liveError = (code: string, message: string, status = 409) => new AppError(message, `live_${code}`, status);

/** Whether online sessions can be offered in this gym: the server is set up and the plan includes them. */
export function liveSessionsAvailable(ctx: { plan: PlanSummary | null }): boolean {
  return !!liveKitConfig() && !!ctx.plan?.features.liveSessions;
}

/** Scheduling or booking an online session needs the same as joining one. */
export function assertLiveSessionsAvailable(ctx: { plan: PlanSummary | null }): void {
  if (!liveKitConfig()) throw liveError("unavailable", M.notConfigured, 503);
  if (!ctx.plan?.features.liveSessions) throw new FeatureNotInPlanError(M.notInPlan);
}

function available(plan: PlanSummary | null, access: SubscriptionAccess): LiveKitConfig {
  const config = liveKitConfig();
  if (!config) throw liveError("unavailable", M.notConfigured, 503);
  if (!plan?.features.liveSessions) throw new FeatureNotInPlanError(M.notInPlan);
  if (!access.writable) throw new GymReadOnlyError(access.reason ? READ_ONLY_MESSAGES[access.reason] : undefined);
  return config;
}

async function loadSession(tx: Tx, kind: LiveKind, id: string): Promise<Session | null> {
  if (kind === "class") {
    const s = await tx.classSession.findFirst({
      where: { id },
      select: { id: true, startsAt: true, endsAt: true, status: true, deliveryMode: true, capacity: true, trainerId: true, classType: { select: { name: true } } },
    });
    return s && { kind, id: s.id, title: s.classType.name, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, deliveryMode: s.deliveryMode, capacity: s.capacity, trainerId: s.trainerId, memberId: null };
  }
  const s = await tx.trainingSession.findFirst({
    where: { id },
    select: { id: true, startsAt: true, endsAt: true, status: true, deliveryMode: true, trainerId: true, memberId: true, focus: true },
  });
  return s && { kind, id: s.id, title: s.focus ? `Personal training: ${s.focus}` : "Personal training", startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, deliveryMode: s.deliveryMode, capacity: 1, trainerId: s.trainerId, memberId: s.memberId };
}

/** Checked after who-may-join, so these never tell an outsider anything about the session. */
function assertJoinableNow(s: Session, now: Date) {
  if (!hasVideoRoom(s.deliveryMode)) throw liveError("in_person", M.inPerson);
  if (s.status === "CANCELLED") throw liveError("cancelled", M.cancelled);
  if (s.status !== "SCHEDULED") throw liveError("closed", M.closed);
  const timing = joinTiming(s.startsAt, s.endsAt, now);
  if (timing === "too_early") throw liveError("too_early", M.tooEarly);
  if (timing === "ended") throw liveError("ended", M.ended);
}

const SOURCES: Record<LiveSource, TrackSource[]> = {
  camera: [TrackSource.CAMERA],
  microphone: [TrackSource.MICROPHONE],
  screen_share: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
};

async function issue(config: LiveKitConfig, gymId: string, s: Session, who: LiveParticipant, name: string, role: LiveRole, now: Date): Promise<LiveJoin> {
  const roomName = liveRoomName(gymId, s.kind, s.id);
  const identity = liveIdentity(who);
  const ttl = tokenTtlSeconds(s.endsAt, now);
  const grants = liveGrants(role);
  const at = new AccessToken(config.apiKey, config.apiSecret, { identity, name, ttl, attributes: { role } });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canSubscribe: grants.canSubscribe,
    canPublish: grants.canPublish,
    canPublishSources: grants.sources.flatMap((source) => SOURCES[source]),
    // No chat in this version: nothing to moderate or keep.
    canPublishData: false,
    canUpdateOwnMetadata: false,
    roomAdmin: grants.roomAdmin,
  });
  at.roomConfig = new RoomConfiguration({ name: roomName, maxParticipants: liveMaxParticipants(s.kind, s.capacity), emptyTimeout: LIVE_EMPTY_ROOM_SECONDS, departureTimeout: 60 });
  const token = await at.toJwt();
  return {
    url: config.url,
    token,
    roomName,
    identity,
    role,
    expiresAt: new Date(now.getTime() + ttl * 1000),
    session: { kind: s.kind, id: s.id, title: s.title, startsAt: s.startsAt, endsAt: s.endsAt, deliveryMode: s.deliveryMode },
  };
}

/** A trainer joining their own class (as host) or PT session, from the web portal or the app. */
export async function joinAsStaff(ctx: TenantContext, kind: LiveKind, sessionId: string, now = new Date()): Promise<LiveJoin> {
  const config = available(ctx.plan, ctx.access);
  if (!ctx.staffId || ctx.supportSessionId) throw new ForbiddenError("Support access can't join live sessions.");
  const staffId = ctx.staffId;
  await enforce([[RATE_LIMITS.liveJoinPerUser, ctx.user.id]]);
  const s = await inTenant(ctx, (tx) => loadSession(tx, kind, sessionId));
  if (!s) throw new NotFoundError("Session not found.");
  if (s.trainerId !== staffId) throw new ForbiddenError(kind === "pt" ? M.notYours : M.notTrainer);
  assertJoinableNow(s, now);
  return issue(config, ctx.gym.id, s, { staffId }, ctx.user.name, kind === "class" ? "host" : "coach", now);
}

/** A member joining a class they have a place in, or their own PT session, from the app. */
export async function joinAsMember(ctx: MemberContext, kind: LiveKind, sessionId: string, now = new Date()): Promise<LiveJoin> {
  const config = available(ctx.plan, ctx.access);
  await enforce([[RATE_LIMITS.liveJoinPerUser, ctx.user.id]]);
  const { s, member } = await inMember(ctx, async (tx) => {
    const s = await loadSession(tx, kind, sessionId);
    if (!s) return { s: null, member: null };
    if (kind === "pt") {
      // Members only ever see their own PT sessions; say "not found" either way.
      if (s.memberId !== ctx.memberId) return { s: null, member: null };
    } else {
      const booking = await tx.booking.findFirst({ where: { sessionId: s.id, memberId: ctx.memberId }, select: { status: true } });
      if (booking?.status === "WAITLISTED") throw new ForbiddenError(M.waitlisted);
      if (booking?.status !== "BOOKED" && booking?.status !== "ATTENDED") throw new ForbiddenError(M.notBooked);
    }
    const member = await tx.member.findFirst({ where: { id: ctx.memberId }, select: { firstName: true, lastName: true } });
    return { s, member };
  });
  if (!s || !member) throw new NotFoundError("Session not found.");
  assertJoinableNow(s, now);
  const name = kind === "class" ? classDisplayName(member.firstName, member.lastName) : `${member.firstName} ${member.lastName}`.trim();
  return issue(config, ctx.gym.id, s, { memberId: ctx.memberId }, name, "member", now);
}


/**
 * The class host mutes someone's microphone or removes them from the call. Only the class's own
 * trainer, during the session. Removing disconnects; to keep someone out, cancel their booking
 * too (they then get no new token).
 */
export async function moderateLive(ctx: TenantContext, sessionId: string, identity: string, action: "mute" | "remove", now = new Date()): Promise<{ done: boolean }> {
  available(ctx.plan, ctx.access);
  if (!ctx.staffId || ctx.supportSessionId) throw new ForbiddenError("Support access can't join live sessions.");
  const staffId = ctx.staffId;
  const s = await inTenant(ctx, (tx) => loadSession(tx, "class", sessionId));
  if (!s) throw new NotFoundError("Session not found.");
  if (s.trainerId !== staffId) throw new ForbiddenError("Only the class's trainer can do that.");
  assertJoinableNow(s, now);
  const who = parseLiveIdentity(identity);
  if (!who) throw new NotFoundError("They aren't in this call.");
  if ("staffId" in who && who.staffId === staffId) throw liveError("self", "That's you.");
  const admin = liveRoomAdmin();
  if (!admin) throw liveError("unavailable", M.notConfigured, 503);
  const room = liveRoomName(ctx.gym.id, "class", s.id);
  const done = action === "mute" ? await admin.muteMicrophone(room, identity) : await admin.removeParticipant(room, identity);
  return { done };
}

/** The call page's heading: what this session is and whether you're its trainer (null: not found). */
export async function liveSessionInfo(ctx: TenantContext, kind: LiveKind, sessionId: string) {
  const s = await inTenant(ctx, (tx) => loadSession(tx, kind, sessionId));
  if (!s) return null;
  return { kind, id: s.id, title: s.title, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, deliveryMode: s.deliveryMode, isTrainer: !!ctx.staffId && s.trainerId === ctx.staffId };
}
