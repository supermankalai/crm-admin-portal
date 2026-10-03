import "server-only";
import { createId } from "@paralleldrive/cuid2";
import type { z } from "zod";
import type { currentGymSchema, deviceInfoSchema, gymSummarySchema } from "@fitcrm/shared/api/schemas";
import { newPasswordSchema } from "@/lib/validation/auth";
import { recordPlatformAudit, recordPlatformAuditStandalone } from "@/server/audit/platform-audit";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/server/auth/password";
import { decryptField, encryptField, userPhoneContext } from "@/server/crypto";
import { withAnonymous, withUser } from "@/server/db/context";
import { getEmailProvider } from "@/server/email";
import { AppError, FeatureNotInPlanError, NotFoundError, UnauthenticatedError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { enforce, hashIdentifier, RATE_LIMITS, RateLimitError, reset } from "@/server/security/rate-limit";
import type { RequestMeta } from "@/server/security/request-meta";
import { getSmsProvider, maskPhone } from "@/server/sms";
import { resolveMemberContext, type MemberContext } from "@/server/tenant/member";
import { resolveTenant } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { signedFilePath } from "./files";
import { inviteTokenHash, newOpaqueToken, newOtpCode, otpCodeHash, otpIdentifierHash, sha256Hex } from "./crypto";
import { maskEmail, parseIdentifier, type Identifier } from "./identifier";
import { signAccessToken } from "./tokens";

/**
 * Mobile sign-in, device sessions and gym selection. Passwords, sessions and audit follow the
 * same rules as the web login; the database functions own the token tables.
 */

export const REFRESH_TOKEN_DAYS = 30;
export const MAX_SESSION_DAYS = 90;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;

type Device = z.infer<typeof deviceInfoSchema>;
type GymSummary = z.infer<typeof gymSummarySchema>;
type CurrentGym = z.infer<typeof currentGymSchema>;
type LookupRow = { id: string; name: string; passwordHash: string; sessionVersion: number; isSuperAdmin: boolean };
export type MobileUser = { id: string; name: string; email: string; isSuperAdmin: boolean };

const INVALID_LOGIN = "Invalid email, phone or password.";

async function lookupUser(identifier: Identifier): Promise<LookupRow | undefined> {
  const rows = await withAnonymous((tx) =>
    identifier.kind === "email"
      ? tx.$queryRaw<LookupRow[]>`SELECT * FROM auth_lookup_user(${identifier.email})`
      : tx.$queryRaw<LookupRow[]>`SELECT * FROM auth_lookup_user_by_phone(${identifier.blind})`
  );
  return rows[0];
}

/** Every one of the user's gyms where they can use the app, staff role first. */
export async function gymsFor(userId: string): Promise<GymSummary[]> {
  const planSelect = { subscription: { select: { plan: { select: { featureMobileApp: true, featureMemberApp: true } } } } } as const;
  const { staff, members } = await withUser(userId, async (tx) => ({
    staff: await tx.staffMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: { role: true, gym: { select: { id: true, slug: true, name: true, brandColor: true, logoFileId: true, status: true, ...planSelect } } },
      orderBy: { gym: { name: "asc" } },
    }),
    members: await tx.memberAccount.findMany({
      where: { userId, status: "ACTIVE" },
      select: { gym: { select: { id: true, slug: true, name: true, brandColor: true, logoFileId: true, status: true, ...planSelect } } },
      orderBy: { gym: { name: "asc" } },
    }),
  }));
  // Membership was just verified by these queries, so the logos can be signed for this user.
  const logoOf = (gym: { id: string; logoFileId: string | null }) => (gym.logoFileId ? signedFilePath(gym.logoFileId, userId, gym.id) : null);
  const out = new Map<string, GymSummary>();
  for (const s of staff) {
    const allowed = s.gym.subscription?.plan.featureMobileApp ?? false;
    out.set(s.gym.slug, { slug: s.gym.slug, name: s.gym.name, brandColor: s.gym.brandColor, logoUrl: logoOf(s.gym), role: s.role, appAccess: { allowed, reason: allowed ? null : "feature_not_in_plan" } });
  }
  for (const m of members) {
    if (out.has(m.gym.slug)) continue; // staff access takes precedence in the same gym
    const allowed = m.gym.subscription?.plan.featureMemberApp ?? false;
    out.set(m.gym.slug, { slug: m.gym.slug, name: m.gym.name, brandColor: m.gym.brandColor, logoUrl: logoOf(m.gym), role: "MEMBER", appAccess: { allowed, reason: allowed ? null : "feature_not_in_plan" } });
  }
  return [...out.values()];
}

/** Open a device session: one refresh-token chain per device. */
export async function startDeviceSession(userId: string, device: Device, meta: RequestMeta) {
  const refreshToken = newOpaqueToken();
  const refreshExpires = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86_400_000);
  const { sessionId, sessionVersion } = await withUser(userId, async (tx) => {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT mobile_session_start(${device.name}, ${device.platform}, ${device.appVersion ?? null}, ${meta.ip}, ${sha256Hex(refreshToken)}, ${refreshExpires}) AS id`;
    const user = await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() }, select: { sessionVersion: true } });
    return { sessionId: row.id, sessionVersion: user.sessionVersion };
  });
  const access = await signAccessToken({ sub: userId, sid: sessionId, sv: sessionVersion });
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: refreshExpires.toISOString(),
    sessionId,
  };
}

async function signedIn(userId: string, name: string, device: Device, meta: RequestMeta, method: "password" | "otp" | "invite") {
  const tokens = await startDeviceSession(userId, device, meta);
  await recordPlatformAuditStandalone({ action: "auth.login", actorUserId: userId, metadata: { channel: "mobile", method, deviceSessionId: tokens.sessionId, platform: device.platform }, meta });
  return { ...tokens, user: { id: userId, name }, gyms: await gymsFor(userId) };
}

function rateLimited(error: unknown, action: string, meta: RequestMeta, metadata: Record<string, unknown>) {
  if (error instanceof RateLimitError) void recordPlatformAuditStandalone({ action, metadata: { channel: "mobile", ...metadata }, meta });
  throw error;
}

// ─────────────────────────────── Password login ───────────────────────────────

export async function loginWithPassword(input: { identifier: string; password: string; device: Device }, meta: RequestMeta) {
  const identifier = parseIdentifier(input.identifier);
  const key = hashIdentifier(identifier?.normalised ?? input.identifier);
  const ip = meta.ip ?? "unknown";
  try {
    await enforce([
      [RATE_LIMITS.loginPerEmailIp, key, ip],
      [RATE_LIMITS.loginPerEmail, key],
      [RATE_LIMITS.loginPerIp, ip],
    ]);
  } catch (error) {
    rateLimited(error, "auth.login_rate_limited", meta, { identifierHash: key });
  }

  const user = identifier ? await lookupUser(identifier) : undefined;
  const valid = user ? await verifyPassword(user.passwordHash, input.password) : await verifyAgainstDummy(input.password);
  if (!user || !valid) {
    await recordPlatformAuditStandalone({ action: "auth.login_failed", actorUserId: user?.id ?? null, metadata: { channel: "mobile", identifierHash: key, reason: user ? "bad_password" : "unknown_identifier" }, meta });
    throw new UnauthenticatedError(INVALID_LOGIN, "invalid_credentials");
  }
  await reset(RATE_LIMITS.loginPerEmailIp, key, ip);
  await reset(RATE_LIMITS.loginPerEmail, key);
  return signedIn(user.id, user.name, input.device, meta, "password");
}

// ─────────────────────────────── One-time codes ───────────────────────────────

/**
 * Always answers the same way whether or not an account exists. If one does, a 6-digit code
 * valid for 5 minutes is sent to that email/phone; only its keyed hash is stored.
 */
export async function requestOtp(input: { identifier: string }, meta: RequestMeta) {
  const identifier = parseIdentifier(input.identifier);
  if (!identifier) return { sent: true as const };
  const key = hashIdentifier(identifier.normalised);
  try {
    await enforce([
      [RATE_LIMITS.otpRequestPerIdentifier, key],
      [RATE_LIMITS.otpRequestPerIp, meta.ip ?? "unknown"],
    ]);
  } catch (error) {
    rateLimited(error, "auth.otp_rate_limited", meta, { identifierHash: key });
  }
  const user = await lookupUser(identifier);
  if (!user) return { sent: true as const };

  const code = newOtpCode();
  const idHash = otpIdentifierHash(identifier.normalised);
  await withAnonymous((tx) => tx.$executeRaw`SELECT otp_issue(${user.id}, ${idHash}, ${otpCodeHash(idHash, code)}, ${OTP_TTL_SECONDS}::int)`);
  const text = `Your FitCRM sign-in code is ${code}. It expires in 5 minutes. Never share it — FitCRM staff will never ask for it.`;
  try {
    if (identifier.kind === "email") await getEmailProvider().send({ to: identifier.email, subject: "Your FitCRM sign-in code", text });
    else await getSmsProvider().send({ to: identifier.phone, text });
  } catch (error) {
    logger.error("otp delivery failed", { kind: identifier.kind, error });
  }
  await recordPlatformAuditStandalone({ action: "auth.otp_requested", actorUserId: user.id, metadata: { channel: "mobile", via: identifier.kind }, meta });
  return { sent: true as const };
}

export async function loginWithOtp(input: { identifier: string; code: string; device: Device }, meta: RequestMeta) {
  const identifier = parseIdentifier(input.identifier);
  const key = hashIdentifier(identifier?.normalised ?? input.identifier);
  try {
    await enforce([
      [RATE_LIMITS.otpVerifyPerIdentifier, key],
      [RATE_LIMITS.otpVerifyPerIp, meta.ip ?? "unknown"],
    ]);
  } catch (error) {
    rateLimited(error, "auth.otp_rate_limited", meta, { identifierHash: key });
  }
  const failed = async (reason: string) => {
    await recordPlatformAuditStandalone({ action: "auth.login_failed", metadata: { channel: "mobile", method: "otp", identifierHash: key, reason }, meta });
    return new UnauthenticatedError("That code is wrong or has expired. Request a new one.", "invalid_code");
  };
  if (!identifier) throw await failed("bad_identifier");

  const idHash = otpIdentifierHash(identifier.normalised);
  const [row] = await withAnonymous((tx) =>
    tx.$queryRaw<{ status: "ok" | "invalid" | "locked"; user_id: string | null }[]>`SELECT * FROM otp_verify(${idHash}, ${otpCodeHash(idHash, input.code)}, ${OTP_MAX_ATTEMPTS}::int)`
  );
  if (row.status !== "ok" || !row.user_id) throw await failed(row.status);
  const user = await lookupUser(identifier);
  if (!user || user.id !== row.user_id) throw await failed("user_changed");
  return signedIn(user.id, user.name, input.device, meta, "otp");
}

// ─────────────────────────────── Member invites ───────────────────────────────

type InviteRow = {
  state: "valid" | "expired" | "used" | "revoked";
  invite_id: string;
  gym_id: string;
  gym_slug: string;
  gym_name: string;
  brand_color: string;
  first_name: string;
  channel: string;
  email: string | null;
  phone_enc: string | null;
  phone_blind: string | null;
  existing_user_id: string | null;
  member_app: boolean;
};

const INVITE_MESSAGES: Record<string, string> = {
  "member_invite:not_found": "This invite isn't valid. Check the link or code, or ask the gym for a new one.",
  "member_invite:revoked": "This invite was withdrawn. Ask the gym for a new one.",
  "member_invite:used": "This invite has already been used. Sign in instead.",
  "member_invite:expired": "This invite has expired. Ask the gym for a new one.",
  "member_invite:already_linked": "This membership is already connected to an app account. Sign in instead.",
  "member_invite:identity_mismatch": "This invite was sent to a different email or phone number.",
  "member_invite:account_exists": "An account already exists for this email or phone. Sign in with its password to connect it.",
  "member_invite:missing_account_details": "Enter your name and a password to create your account.",
  "member_invite:already_member": "Your account is already connected to this gym.",
};

function inviteError(code: string): ValidationError {
  return new ValidationError(INVITE_MESSAGES[code] ?? INVITE_MESSAGES["member_invite:not_found"]);
}

async function findInvite(token: string, meta: RequestMeta): Promise<InviteRow> {
  try {
    await enforce([[RATE_LIMITS.invitePerIp, meta.ip ?? "unknown"]]);
  } catch (error) {
    rateLimited(error, "member.invite_rate_limited", meta, {});
  }
  const [row] = await withAnonymous((tx) => tx.$queryRaw<InviteRow[]>`SELECT * FROM member_invite_lookup(${inviteTokenHash(token)})`);
  if (!row) throw new NotFoundError(INVITE_MESSAGES["member_invite:not_found"]);
  return row;
}

function invitePhone(row: InviteRow): string | null {
  return row.phone_enc ? decryptField(row.phone_enc, { gymId: row.gym_id, model: "MemberAppInvite", field: "phone", recordId: row.invite_id }) : null;
}

export async function lookupMemberInvite(input: { token: string }, meta: RequestMeta) {
  const row = await findInvite(input.token, meta);
  const phone = invitePhone(row);
  return {
    state: row.state,
    gym: { name: row.gym_name, brandColor: row.brand_color },
    firstName: row.first_name,
    hasAccount: !!row.existing_user_id,
    destination: row.email ? maskEmail(row.email) : phone ? maskPhone(phone) : "",
  };
}

export async function redeemMemberInvite(input: { token: string; name?: string; password: string; device: Device }, meta: RequestMeta) {
  const row = await findInvite(input.token, meta);
  if (row.state !== "valid") throw inviteError(`member_invite:${row.state}`);
  if (!row.member_app) throw new FeatureNotInPlanError(`${row.gym_name}'s plan doesn't include the member app yet. Ask the gym.`);

  let existingUserId: string | null = null;
  let newUserId: string | null = null;
  let phoneEnc: string | null = null;
  let passwordHash: string | null = null;
  let name = input.name?.trim() || row.first_name;

  if (row.existing_user_id) {
    // Linking an existing login: prove it's yours with its current password.
    const [user] = await withAnonymous((tx) =>
      row.email ? tx.$queryRaw<LookupRow[]>`SELECT * FROM auth_lookup_user(${row.email})` : tx.$queryRaw<LookupRow[]>`SELECT * FROM auth_lookup_user_by_phone(${row.phone_blind})`
    );
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      await recordPlatformAuditStandalone({ action: "auth.login_failed", actorUserId: user?.id ?? null, metadata: { channel: "mobile", method: "invite", reason: "bad_password" }, meta });
      throw new UnauthenticatedError("That password doesn't match your existing account.", "invalid_credentials");
    }
    existingUserId = user.id;
    name = user.name;
  } else {
    const policy = newPasswordSchema.safeParse(input.password);
    if (!policy.success) throw new ValidationError("Choose a stronger password.", { password: policy.error.issues.map((i) => i.message) });
    newUserId = createId();
    const phone = invitePhone(row);
    phoneEnc = phone ? encryptField(phone, userPhoneContext(newUserId)) : null;
    passwordHash = await hashPassword(input.password);
  }

  let result: { user_id: string; gym_slug: string };
  try {
    [result] = await withAnonymous((tx) =>
      tx.$queryRaw<{ user_id: string; gym_slug: string }[]>`
        SELECT * FROM member_invite_redeem(${inviteTokenHash(input.token)}, ${existingUserId}, ${newUserId}, ${name}, ${phoneEnc}, ${passwordHash})`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = Object.keys(INVITE_MESSAGES).find((k) => message.includes(k));
    if (code) throw inviteError(code);
    throw error;
  }
  return signedIn(result.user_id, name, input.device, meta, "invite");
}

// ─────────────────────────────── Refresh & gym selection ───────────────────────────────

export function toMobileUser(u: { id: string; name: string; email: string | null; isSuperAdmin: boolean }): MobileUser {
  return { id: u.id, name: u.name, email: u.email ?? "", isSuperAdmin: u.isSuperAdmin };
}

export function currentGymOf(ctx: TenantContext | MemberContext): CurrentGym {
  const isMember = "kind" in ctx && ctx.kind === "member";
  return {
    slug: ctx.gym.slug,
    name: ctx.gym.name,
    brandColor: ctx.gym.brandColor,
    logoUrl: ctx.gym.logoFileId ? signedFilePath(ctx.gym.logoFileId, ctx.user.id, ctx.gym.id) : null,
    timezone: ctx.gym.timezone,
    currency: ctx.gym.currency,
    role: isMember ? "MEMBER" : (ctx as TenantContext).role,
    permissions: isMember ? [] : [...(ctx as TenantContext).permissions],
    access: { writable: ctx.access.writable, reason: ctx.access.reason, isTrial: ctx.access.isTrial, endsAt: ctx.access.endsAt?.toISOString() ?? null },
  };
}

/**
 * Scope a token to one gym. The slug only says which of the user's gyms; membership (active
 * staff, or an active member account) and the plan's app feature are checked here and again
 * on every request.
 */
export async function scopeToGym(user: MobileUser, sessionId: string, sessionVersion: number, gymSlug: string) {
  const staff = await resolveTenant(user, gymSlug);
  if (staff) {
    if (!staff.plan?.features.mobileApp) throw new FeatureNotInPlanError(`${staff.gym.name}'s plan doesn't include the staff mobile app. Use the web portal, or ask the owner to upgrade.`);
    const access = await signAccessToken({ sub: user.id, sid: sessionId, sv: sessionVersion, gid: staff.gym.id, k: "staff" });
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), gym: currentGymOf(staff) };
  }
  const member = await resolveMemberContext(user, { slug: gymSlug });
  if (member) {
    if (!member.plan?.features.memberApp) throw new FeatureNotInPlanError(`${member.gym.name}'s plan doesn't include the member app yet.`);
    const access = await signAccessToken({ sub: user.id, sid: sessionId, sv: sessionVersion, gid: member.gym.id, k: "member" });
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), gym: currentGymOf(member) };
  }
  throw new NotFoundError("Gym not found.");
}

export async function refreshSession(input: { refreshToken: string; gymSlug?: string }, meta: RequestMeta) {
  try {
    await enforce([[RATE_LIMITS.refreshPerIp, meta.ip ?? "unknown"]]);
  } catch (error) {
    rateLimited(error, "mobile.refresh_rate_limited", meta, {});
  }
  const newToken = newOpaqueToken();
  const newExpires = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86_400_000);
  const [row] = await withAnonymous((tx) =>
    tx.$queryRaw<{ status: "ok" | "reused" | "revoked" | "expired" | "invalid"; user_id: string | null; session_id: string | null }[]>`
      SELECT * FROM mobile_refresh_rotate(${sha256Hex(input.refreshToken)}, ${sha256Hex(newToken)}, ${newExpires}, ${MAX_SESSION_DAYS}::int)`
  );
  if (row.status === "reused") {
    await recordPlatformAuditStandalone({ action: "mobile.refresh_reuse", actorUserId: row.user_id, metadata: { deviceSessionId: row.session_id }, meta });
    throw new UnauthenticatedError("For your security you were signed out on this device. Please sign in again.", "session_revoked");
  }
  if (row.status === "revoked") throw new UnauthenticatedError("This device was signed out. Please sign in again.", "session_revoked");
  if (row.status === "expired") throw new UnauthenticatedError("Your session has expired. Please sign in again.", "session_expired");
  if (row.status !== "ok" || !row.user_id || !row.session_id) throw new UnauthenticatedError("Please sign in again.", "refresh_invalid");

  const userId = row.user_id;
  const sessionId = row.session_id;
  const dbUser = await withUser(userId, (tx) => tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, isSuperAdmin: true, sessionVersion: true } }));
  let accessToken: string;
  let accessTokenExpiresAt: string;
  let gym: CurrentGym | null = null;
  let gymError: { code: string; message: string } | null = null;
  if (input.gymSlug) {
    // The refresh token has already rotated: never fail the whole call because of the gym, or
    // the client would lose the new token and its next refresh would look like reuse.
    try {
      ({ accessToken, accessTokenExpiresAt, gym } = await scopeToGym(toMobileUser(dbUser), sessionId, dbUser.sessionVersion, input.gymSlug));
      return { accessToken, accessTokenExpiresAt, refreshToken: newToken, refreshTokenExpiresAt: newExpires.toISOString(), sessionId, gym, gymError };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      gymError = { code: error.code, message: error.message };
    }
  }
  const access = await signAccessToken({ sub: userId, sid: sessionId, sv: dbUser.sessionVersion });
  accessToken = access.token;
  accessTokenExpiresAt = access.expiresAt.toISOString();
  return { accessToken, accessTokenExpiresAt, refreshToken: newToken, refreshTokenExpiresAt: newExpires.toISOString(), sessionId, gym, gymError };
}

// ─────────────────────────────── Devices ───────────────────────────────

export async function listDevices(userId: string, currentSessionId: string) {
  const sessions = await withUser(userId, (tx) =>
    tx.mobileDeviceSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, deviceName: true, platform: true, appVersion: true, createdAt: true, lastSeenAt: true },
    })
  );
  return {
    devices: sessions.map((s) => ({
      id: s.id,
      name: s.deviceName,
      platform: s.platform,
      appVersion: s.appVersion,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.id === currentSessionId,
    })),
  };
}

/** Sign a device out (also this one, on logout). Its refresh chain stops working immediately. */
export async function revokeDevice(userId: string, sessionId: string, reason: "logout" | "user_revoked", meta: RequestMeta) {
  const changed = await withUser(userId, async (tx) => {
    const r = await tx.mobileDeviceSession.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
    if (r.count) await recordPlatformAudit(tx, { action: reason === "logout" ? "auth.logout" : "mobile.device_revoked", actorUserId: userId, metadata: { channel: "mobile", deviceSessionId: sessionId }, meta });
    return r.count;
  });
  if (!changed && reason === "user_revoked") throw new NotFoundError("Device not found.");
  return { ok: true as const };
}
