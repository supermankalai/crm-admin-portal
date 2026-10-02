import "server-only";
import { getEnv } from "@/server/env";

/**
 * CSRF protection for state-changing API route handlers. Server Actions already get Next.js's
 * built-in Origin check; route handlers must call this. Requests must come from our own origin.
 */
export function isSameOrigin(request: Request): boolean {
  const expected = new URL(getEnv().APP_URL).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;
  // Some same-origin requests omit Origin; fall back to the fetch metadata header.
  return request.headers.get("sec-fetch-site") === "same-origin";
}
