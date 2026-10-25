import "server-only";
import { dedupeKey, type NotificationKind } from "@/domain/notifications";
import type { Tx } from "@/server/db/context";
import { inAppChannel } from "@/server/notifications";

/**
 * Personal training alerts. They go to the inbox inside the current transaction (so an alert
 * exists only if the change did), and the push job sends them on with generic lock-screen text.
 * Members are told only if they use the member app; staff by their user account.
 */

export type PtAlert = { userId: string; type: NotificationKind; title: string; body: string; entityType: string; entityId: string; subject: string };

/** The member's app account, if they have an active one (SECURITY DEFINER: staff can't read accounts' users). */
export async function memberUserId(tx: Tx, memberId: string): Promise<string | null> {
  const [row] = await tx.$queryRaw<{ user_id: string | null }[]>`SELECT member_app_user_id(${memberId}) AS user_id`;
  return row?.user_id ?? null;
}

export async function staffUserId(tx: Tx, staffId: string): Promise<string | null> {
  const s = await tx.staffMember.findFirst({ where: { id: staffId, status: "ACTIVE" }, select: { userId: true } });
  return s?.userId ?? null;
}

export async function sendPtAlerts(tx: Tx, gymId: string, alerts: (PtAlert | null)[]) {
  const messages = alerts
    .filter((a): a is PtAlert => a !== null)
    .map((a) => ({
      gymId,
      recipientUserId: a.userId,
      type: a.type,
      title: a.title,
      body: a.body,
      entityType: a.entityType,
      entityId: a.entityId,
      dedupeKey: dedupeKey(a.type, a.subject, a.userId),
    }));
  return inAppChannel.send(tx, messages);
}
