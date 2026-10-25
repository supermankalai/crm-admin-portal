import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// Tests never reach a real LiveKit server: join tokens are signed and checked locally with this
// throwaway key, and room closing goes to a fake (setLiveRoomAdminForTests).
process.env.LIVEKIT_URL = "wss://livekit.test";
process.env.LIVEKIT_API_KEY = "APItestkey";
process.env.LIVEKIT_API_SECRET = "test-secret-for-live-sessions-0001";
