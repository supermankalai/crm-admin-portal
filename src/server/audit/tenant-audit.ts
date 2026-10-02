import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/db/context";
import { redact } from "@/server/logger";
import type { RequestMeta } from "@/server/security/request-meta";
import type { TenantContext } from "@/server/tenant/types";

export type AuditEvent = {
  action: string;
  entityType: string;
  entityId?: string | null;
  /** {field: {from, to}} or a summary. Personal fields are redacted automatically. */
  changes?: Record<string, unknown>;
};

/**
 * Append a tenant audit entry inside the same transaction as the change it describes, so the
 * change and its audit record commit (or roll back) together.
 */
export async function recordAudit(tx: Tx, ctx: TenantContext, event: AuditEvent, meta?: RequestMeta) {
  await tx.auditLog.createMany({
    data: [
      {
        gymId: ctx.gym.id,
        actorUserId: ctx.user.id,
        actorType: ctx.supportSessionId ? "SUPPORT" : "USER",
        supportSessionId: ctx.supportSessionId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        changes: (redact(event.changes ?? {}) ?? {}) as Prisma.InputJsonValue,
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
      },
    ],
  });
}
