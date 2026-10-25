import "server-only";
import { withUser } from "@/server/db/context";
import { FeatureNotInPlanError, ForbiddenError, UnauthenticatedError } from "@/server/errors";
import { resolveMemberContext, type MemberContext } from "@/server/tenant/member";
import { resolveTenantByGymId } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { toMobileUser, type MobileUser } from "./auth";
import { verifyAccessToken } from "./tokens";

/**
 * Authenticate a mobile request. The access token is only a pointer: the device session, the
 * user's sessionVersion, the gym membership and the plan's app feature are all re-checked in the
 * database on every request, so a revoked device, a password change, removal from the gym or a
 * plan downgrade takes effect immediately — not when the token expires.
 */

export type UserAuth = { user: MobileUser; sessionId: string; sessionVersion: number };
export type StaffAuth = UserAuth & { kind: "staff"; staff: TenantContext };
export type MemberAuth = UserAuth & { kind: "member"; member: MemberContext };
export type GymAuth = StaffAuth | MemberAuth;

function bearer(headers: Headers): string | null {
  const value = headers.get("authorization");
  const match = value ? /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(value) : null;
  return match ? match[1] : null;
}

export async function authenticateUser(headers: Headers): Promise<UserAuth & { gymId?: string; kind?: "staff" | "member" }> {
  const token = bearer(headers);
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims) throw new UnauthenticatedError("Please sign in again.", "invalid_token");

  const found = await withUser(claims.sub, async (tx) => ({
    session: await tx.mobileDeviceSession.findFirst({ where: { id: claims.sid, userId: claims.sub }, select: { revokedAt: true, sessionVersion: true } }),
    user: await tx.user.findUnique({ where: { id: claims.sub }, select: { id: true, name: true, email: true, isSuperAdmin: true, sessionVersion: true } }),
  }));
  const { session, user } = found;
  if (!session || session.revokedAt || !user || user.sessionVersion !== claims.sv || session.sessionVersion !== user.sessionVersion) {
    throw new UnauthenticatedError("This device was signed out. Please sign in again.", "session_revoked");
  }
  return { user: toMobileUser(user), sessionId: claims.sid, sessionVersion: user.sessionVersion, gymId: claims.gid, kind: claims.k };
}

export async function authenticateGym(headers: Headers, need: "gym" | "staff" | "member"): Promise<GymAuth> {
  const auth = await authenticateUser(headers);
  if (!auth.gymId || !auth.kind) throw new ForbiddenError("Choose a gym first.");
  const base: UserAuth = { user: auth.user, sessionId: auth.sessionId, sessionVersion: auth.sessionVersion };

  if (auth.kind === "staff") {
    if (need === "member") throw new ForbiddenError("This is only available to members.");
    const staff = await resolveTenantByGymId(auth.user, auth.gymId);
    if (!staff) throw new ForbiddenError("You no longer have access to this gym.");
    if (!staff.plan?.features.mobileApp) throw new FeatureNotInPlanError(`${staff.gym.name}'s plan doesn't include the staff mobile app.`);
    return { ...base, kind: "staff", staff };
  }

  if (need === "staff") throw new ForbiddenError("This is only available to gym staff.");
  const member = await resolveMemberContext(auth.user, { id: auth.gymId });
  if (!member) throw new ForbiddenError("You no longer have access to this gym.");
  if (!member.plan?.features.memberApp) throw new FeatureNotInPlanError(`${member.gym.name}'s plan doesn't include the member app.`);
  return { ...base, kind: "member", member };
}
