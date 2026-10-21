import "server-only";
import { getEnv } from "@/server/env";

export type LiveKitConfig = {
  /** What browsers and phones connect to (wss://). */
  url: string;
  /** The server API, at the matching https:// address. */
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
};

/** The LiveKit server, or null when live sessions aren't set up (env.ts requires all three or none). */
export function liveKitConfig(): LiveKitConfig | null {
  const env = getEnv();
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return null;
  return {
    url: env.LIVEKIT_URL,
    apiUrl: env.LIVEKIT_URL.replace(/^ws(s?):\/\//, "http$1://"),
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
  };
}
