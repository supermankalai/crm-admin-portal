/**
 * Check the LiveKit setup before turning live sessions on:
 *   npm run live:check
 *
 * - LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are set and valid.
 * - The server answers on its API address, and the key and secret are accepted.
 * - A room can be created and closed (a throwaway "live-check-…" room; this app's rooms are named
 *   g_…, so the check never touches them or other apps' rooms).
 * - The app's webhook URL rejects unsigned calls (only if the app is running at APP_URL).
 *
 * Prints no secrets. TURN can't be checked from here: join a test call from a phone on mobile data.
 */
import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getEnv } = await import("@/server/env");
  const { liveKitConfig } = await import("@/server/services/live/config");
  const { RoomServiceClient } = await import("livekit-server-sdk");
  const env = getEnv();
  const config = liveKitConfig();
  if (!config) {
    console.log("✖ Live sessions are off: set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env.");
    process.exit(1);
  }
  console.log(`• Clients connect to ${config.url}`);
  console.log(`• Server API at ${config.apiUrl}`);

  const client = new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret);
  try {
    const rooms = await client.listRooms();
    const ours = rooms.filter((r) => r.name.startsWith("g_")).length;
    console.log(`✔ API key accepted (${rooms.length} open rooms, ${ours} of them this app's)`);
  } catch (error) {
    const status = (error as { status?: number }).status;
    console.log(`✖ The server refused the API call${status ? ` (HTTP ${status})` : ""}: ${error instanceof Error ? error.message : error}`);
    console.log(status === 401 ? "  Check LIVEKIT_API_KEY and LIVEKIT_API_SECRET (key first, then secret)." : "  Check that LIVEKIT_URL is right and the server is reachable over https.");
    process.exit(1);
  }

  const probe = `live-check-${randomBytes(4).toString("hex")}`;
  try {
    await client.createRoom({ name: probe, emptyTimeout: 10, maxParticipants: 1 });
    await client.deleteRoom(probe);
    console.log("✔ A test room was created and closed");
  } catch (error) {
    console.log(`✖ Couldn't create and close a test room: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  const webhook = new URL("/api/livekit/webhook", env.APP_URL).toString();
  try {
    const res = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/webhook+json" }, body: "{}", signal: AbortSignal.timeout(5_000) });
    console.log(res.status === 401 ? `✔ ${webhook} is up and rejects unsigned calls` : `! ${webhook} answered HTTP ${res.status} to an unsigned call (expected 401)`);
  } catch {
    console.log(`! The app isn't reachable at ${webhook} from here (start it to check the webhook).`);
  }
  console.log(`\nOn the LiveKit server, send webhooks to ${webhook} signed with API key ${config.apiKey.slice(0, 4)}….`);
  console.log("LiveKit must be able to reach that address: localhost works only if LiveKit runs on this machine.");
}

main().catch((error: unknown) => {
  console.error("✖ live:check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
