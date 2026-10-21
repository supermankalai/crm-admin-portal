import "server-only";
import { WebhookReceiver } from "livekit-server-sdk";
import { parseLiveRoomName } from "@/domain/live";
import { withAnonymous } from "@/server/db/context";
import { AppError, UnauthenticatedError } from "@/server/errors";
import { liveKitConfig } from "./config";

/**
 * LiveKit's webhook: who joined and left which room, and when a room closed. The signature (a
 * token signed with this app's API secret, carrying the body's hash) is checked first; anything
 * unsigned, altered or for a room this app didn't name is ignored. Attendance is written by the
 * database function app_record_live_event(), which checks the room and the person once more.
 */

const EVENTS = { participant_joined: "joined", participant_left: "left", room_finished: "finished" } as const;

export async function handleLiveWebhook(body: string, authorization: string | null): Promise<{ recorded: boolean }> {
  const config = liveKitConfig();
  if (!config) throw new AppError("Live sessions aren't set up on this server.", "live_unavailable", 503);
  if (!authorization) throw new UnauthenticatedError("Missing webhook signature.", "invalid_signature");
  let event;
  try {
    event = await new WebhookReceiver(config.apiKey, config.apiSecret).receive(body, authorization);
  } catch {
    throw new UnauthenticatedError("Invalid webhook signature.", "invalid_signature");
  }

  const kind = EVENTS[event.event as keyof typeof EVENTS];
  const room = event.room?.name ? parseLiveRoomName(event.room.name) : null;
  if (!kind || !room) return { recorded: false };
  const identity = kind === "finished" ? "" : (event.participant?.identity ?? "");
  if (kind !== "finished" && !identity) return { recorded: false };
  // LiveKit stamps each event in seconds; fall back to now for older servers.
  const seconds = Number(event.createdAt ?? 0);
  const at = seconds > 0 ? new Date(seconds * 1000) : new Date();

  const [row] = await withAnonymous((tx) =>
    tx.$queryRaw<{ recorded: boolean }[]>`
      SELECT app_record_live_event(${room.gymId}, ${room.kind === "class" ? "CLASS" : "PT"}::"LiveRoomKind", ${room.sessionId}, ${identity}, ${kind}, ${at}) AS recorded`
  );
  return { recorded: row?.recorded ?? false };
}
