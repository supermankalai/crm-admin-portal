import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { withAnonymous, type Tx } from "@/server/db/context";
import { logger, redact } from "@/server/logger";
import type { RequestMeta } from "@/server/security/request-meta";

/**
 * Platform-level audit events: logins, failed logins, sign-ups, super admin actions.
 * Rows are append-only (no UPDATE/DELETE grant + trigger). Metadata is redacted.
 */

export type PlatformAuditEvent = {
  action: string;
  actorUserId?: string | null;
  gymId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
};

function toRow(event: PlatformAuditEvent) {
  return {
    action: event.action,
    actorUserId: event.actorUserId ?? null,
    gymId: event.gymId ?? null,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    metadata: (redact(event.metadata ?? {}) ?? {}) as Prisma.InputJsonValue,
    ip: event.meta?.ip ?? null,
    userAgent: event.meta?.userAgent ?? null,
  };
}

/** Write inside an existing transaction (so the audit row commits with the change). */
export async function recordPlatformAudit(tx: Tx, event: PlatformAuditEvent) {
  // createMany issues INSERT without RETURNING: the app role may append but not read back.
  await tx.platformAuditLog.createMany({ data: [toRow(event)] });
}

/** Standalone write (e.g. failed login, where there is no surrounding transaction). */
export async function recordPlatformAuditStandalone(event: PlatformAuditEvent) {
  try {
    await withAnonymous((tx) => recordPlatformAudit(tx, event));
  } catch (error) {
    // Auditing must not take the request down, but it must be visible to operators.
    logger.error("platform audit write failed", { action: event.action, error });
  }
}
