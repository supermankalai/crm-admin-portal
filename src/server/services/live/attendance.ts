import "server-only";
import type { LiveKind } from "@/domain/live";
import { inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";

export type LivePresence = { seconds: number; connected: boolean };

/**
 * Who joined these sessions online, per session and per member or staff id, from the webhook's
 * records. Someone still connected counts their time so far.
 */
export async function liveAttendance(ctx: TenantContext, kind: LiveKind, sessionIds: string[], now = new Date()) {
  const bySession = new Map<string, Map<string, LivePresence>>();
  if (sessionIds.length === 0) return bySession;
  const rows = await inTenant(ctx, (tx) =>
    tx.liveAttendance.findMany({
      where: { kind: kind === "class" ? "CLASS" : "PT", sessionId: { in: sessionIds } },
      select: { sessionId: true, memberId: true, staffId: true, seconds: true, connectedAt: true },
    })
  );
  for (const r of rows) {
    const live = r.connectedAt ? Math.max(0, Math.floor((now.getTime() - r.connectedAt.getTime()) / 1000)) : 0;
    const people = bySession.get(r.sessionId) ?? new Map<string, LivePresence>();
    people.set((r.memberId ?? r.staffId)!, { seconds: r.seconds + live, connected: !!r.connectedAt });
    bySession.set(r.sessionId, people);
  }
  return bySession;
}

/** "42 min", "under a minute", "1 h 5 min". */
export function presenceLabel(p: LivePresence): string {
  const min = Math.floor(p.seconds / 60);
  const time = min < 1 ? "under a minute" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
  return p.connected ? `online now · ${time}` : `joined online · ${time}`;
}
