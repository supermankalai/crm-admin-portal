import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/server/env";
import { SUPPORT_SESSION_MINUTES } from "./sessions";

/**
 * Holds only the id of the super admin's current support session. It grants nothing by
 * itself: every request re-validates the session against the database (owner, gym, expiry).
 */
const NAME = "fitcrm_support";

export async function setSupportCookie(sessionId: string) {
  (await cookies()).set(NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: SUPPORT_SESSION_MINUTES * 60,
  });
}

export async function readSupportCookie(): Promise<string | null> {
  const value = (await cookies()).get(NAME)?.value;
  return value && /^[\w-]{10,64}$/.test(value) ? value : null;
}

export async function clearSupportCookie() {
  (await cookies()).delete(NAME);
}
