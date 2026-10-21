import "server-only";
import { RoomServiceClient } from "livekit-server-sdk";
import { parseLiveRoomName } from "@/domain/live";
import { logger } from "@/server/logger";
import { liveKitConfig } from "./config";

/**
 * Closing rooms on the LiveKit server. Rooms are never created here: each join token carries the
 * room's settings and LiveKit creates the room on the first join. Closing one disconnects
 * everyone in it, which is how a cancelled or finished session ends for good.
 */

export interface LiveRoomAdmin {
  /** Names of the rooms that exist right now. */
  listRooms(): Promise<string[]>;
  /** Close a room (fine if it doesn't exist). */
  deleteRoom(name: string): Promise<void>;
}

class LiveKitRoomAdmin implements LiveRoomAdmin {
  constructor(private readonly client: RoomServiceClient) {}

  async listRooms() {
    return (await this.client.listRooms()).map((r) => r.name);
  }

  async deleteRoom(name: string) {
    try {
      await this.client.deleteRoom(name);
    } catch (error) {
      // Already gone (nobody joined, or it emptied out): nothing to close.
      if ((error as { status?: number }).status === 404) return;
      throw error;
    }
  }
}

let override: LiveRoomAdmin | null | undefined;

/** Tests swap in a fake; `undefined` goes back to the real server. */
export function setLiveRoomAdminForTests(admin: LiveRoomAdmin | null | undefined) {
  override = admin;
}

export function liveRoomAdmin(): LiveRoomAdmin | null {
  if (override !== undefined) return override;
  const config = liveKitConfig();
  return config ? new LiveKitRoomAdmin(new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret)) : null;
}

/**
 * Close a session's room after the change that ended it has been committed. Best effort: if the
 * LiveKit server can't be reached, the jobs runner closes the room on its next pass anyway, and
 * no new tokens are issued for the session meanwhile.
 */
export async function closeLiveRoom(roomName: string): Promise<void> {
  const admin = liveRoomAdmin();
  if (!admin) return;
  try {
    await admin.deleteRoom(roomName);
  } catch (error) {
    const parsed = parseLiveRoomName(roomName);
    logger.warn("live room close failed", { kind: parsed?.kind, sessionId: parsed?.sessionId, error: error instanceof Error ? error.message : "unknown" });
  }
}
