import "server-only";
import { recordPlatformAudit, recordPlatformAuditStandalone } from "@/server/audit/platform-audit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { withUser } from "@/server/db/context";
import { ValidationError } from "@/server/errors";
import { enforce, RATE_LIMITS } from "@/server/security/rate-limit";
import type { RequestMeta } from "@/server/security/request-meta";

/**
 * The signed-in user's own account. Both operations bump User.sessionVersion, which every request
 * checks (getSessionUser), so every existing session — on every device, including this one —
 * stops working immediately.
 */

export async function changePassword(userId: string, input: { currentPassword: string; newPassword: string }, meta: RequestMeta) {
  await enforce([[RATE_LIMITS.passwordChangePerUser, userId]]);
  // Hash outside the transaction: argon2id is deliberately slow.
  const newHash = await hashPassword(input.newPassword);
  const changed = await withUser(userId, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) return false;
    await tx.user.update({ where: { id: userId }, data: { passwordHash: newHash, sessionVersion: { increment: 1 } }, select: { id: true } });
    await recordPlatformAudit(tx, { action: "auth.password_change", actorUserId: userId, meta });
    return true;
  });
  if (!changed) {
    // Nothing changed; record the failed attempt on its own.
    await recordPlatformAuditStandalone({ action: "auth.password_change_failed", actorUserId: userId, meta });
    throw new ValidationError("Your current password is incorrect.", { currentPassword: ["Incorrect password"] });
  }
}

export async function signOutEverywhere(userId: string, meta: RequestMeta) {
  await withUser(userId, async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } }, select: { id: true } });
    await recordPlatformAudit(tx, { action: "auth.sessions_revoked", actorUserId: userId, meta });
  });
}
