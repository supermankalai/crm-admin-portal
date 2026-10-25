import "server-only";
import { recordPlatformAudit } from "@/server/audit/platform-audit";
import { withPlatformAdmin } from "@/server/db/context";
import { NotFoundError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";

/** Support access lasts at most this long; the RLS policy re-checks expiry on every query. */
export const SUPPORT_SESSION_MINUTES = 60;

/**
 * Explicit, audited "break-glass" access by a super admin to ONE gym, read-only.
 * Starting a session ends any other open session of the same admin.
 */
export function startSupportSession(adminId: string, gymId: string, reason: string, meta: RequestMeta) {
  return withPlatformAdmin(adminId, async (tx) => {
    const gym = await tx.gym.findUnique({ where: { id: gymId }, select: { id: true, slug: true } });
    if (!gym) throw new NotFoundError("Gym not found.");
    const now = new Date();
    await tx.supportAccessSession.updateMany({
      where: { superAdminId: adminId, endedAt: null },
      data: { endedAt: now },
    });
    const session = await tx.supportAccessSession.create({
      data: { gymId, superAdminId: adminId, reason, startedAt: now, expiresAt: new Date(now.getTime() + SUPPORT_SESSION_MINUTES * 60_000) },
      select: { id: true, expiresAt: true },
    });
    await recordPlatformAudit(tx, {
      action: "support.start",
      actorUserId: adminId,
      gymId,
      targetType: "SupportAccessSession",
      targetId: session.id,
      metadata: { reason, slug: gym.slug, expiresAt: session.expiresAt },
      meta,
    });
    return { sessionId: session.id, slug: gym.slug };
  });
}

export function endSupportSession(adminId: string, sessionId: string, meta: RequestMeta) {
  return withPlatformAdmin(adminId, async (tx) => {
    const session = await tx.supportAccessSession.findFirst({ where: { id: sessionId, superAdminId: adminId } });
    if (!session) return null;
    if (!session.endedAt) {
      await tx.supportAccessSession.update({ where: { id: sessionId }, data: { endedAt: new Date() }, select: { id: true } });
      await recordPlatformAudit(tx, { action: "support.end", actorUserId: adminId, gymId: session.gymId, targetType: "SupportAccessSession", targetId: sessionId, meta });
    }
    return { gymId: session.gymId };
  });
}
