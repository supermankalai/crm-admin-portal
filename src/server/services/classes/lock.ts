import "server-only";
import type { Tx } from "@/server/db/context";
import { NotFoundError } from "@/server/errors";

/**
 * Serialise every change to one class session (bookings, cancellations, capacity changes,
 * cancelling the class) with a transaction-scoped advisory lock. Unlike SELECT … FOR UPDATE it
 * doesn't need UPDATE rights on the session row, so staff and member-app bookings queue on the
 * same lock — which is what guarantees no overbooking across both.
 */
export async function lockClassSession(tx: Tx, sessionId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`class-session:${sessionId}`}))`;
  const session = await tx.classSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new NotFoundError("Class not found.");
  return session;
}
