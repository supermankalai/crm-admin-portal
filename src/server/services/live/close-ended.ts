import "server-only";
import { hasVideoRoom, joinTiming, parseLiveRoomName } from "@/domain/live";
import type { OwnerClient } from "@/server/db/owner";
import { liveRoomAdmin } from "./rooms";

/**
 * Close this app's LiveKit rooms whose session is over: its window has closed, or it was
 * cancelled (in case closing it at the time failed), deleted or moved in person. Run by the jobs
 * runner as the owner role. Rooms with names this app doesn't use are never touched, so other
 * apps can share the LiveKit server.
 */
export async function closeEndedLiveRooms(db: OwnerClient, now = new Date()): Promise<{ open: number; closed: number }> {
  const admin = liveRoomAdmin();
  if (!admin) return { open: 0, closed: 0 };
  const rooms = (await admin.listRooms()).flatMap((name) => {
    const parsed = parseLiveRoomName(name);
    return parsed ? [{ name, ...parsed }] : [];
  });
  if (rooms.length === 0) return { open: 0, closed: 0 };

  const ids = (kind: "class" | "pt") => rooms.filter((r) => r.kind === kind).map((r) => r.sessionId);
  const select = { id: true, gymId: true, status: true, startsAt: true, endsAt: true, deliveryMode: true } as const;
  const sessions = new Map(
    [
      ...(await db.classSession.findMany({ where: { id: { in: ids("class") } }, select })).map((s) => [`class:${s.id}`, s] as const),
      ...(await db.trainingSession.findMany({ where: { id: { in: ids("pt") } }, select })).map((s) => [`pt:${s.id}`, s] as const),
    ]
  );

  let closed = 0;
  for (const room of rooms) {
    const s = sessions.get(`${room.kind}:${room.sessionId}`);
    const over =
      !s ||
      s.gymId !== room.gymId ||
      !hasVideoRoom(s.deliveryMode) ||
      s.status === "CANCELLED" ||
      joinTiming(s.startsAt, s.endsAt, now) === "ended";
    if (!over) continue;
    await admin.deleteRoom(room.name);
    closed++;
  }
  return { open: rooms.length - closed, closed };
}
