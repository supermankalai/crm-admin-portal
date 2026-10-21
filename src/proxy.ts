import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request CSP nonce. Authorization is NOT done here — every page, action and route
 * handler checks the session and tenant itself (see src/server/auth and src/server/tenant).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  // Live calls (docs/LIVE_SESSIONS.md) connect the browser straight to the LiveKit server: its
  // signalling socket (wss://) and its HTTPS address (connection checks). Nothing else.
  const live = liveKitOrigins(process.env.LIVEKIT_URL);

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used by Radix and Recharts for positioning.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${live}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Used by the support-access audit trail to record which page was viewed.
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/** " wss://host https://host" for the configured LiveKit server, or "" when there is none. */
function liveKitOrigins(url: string | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.protocol !== "wss:" && u.protocol !== "ws:") return "";
    return ` ${u.protocol}//${u.host} ${u.protocol === "wss:" ? "https:" : "http:"}//${u.host}`;
  } catch {
    return "";
  }
}

export const config = {
  matcher: [
    // Prefetches go through the proxy too: it must always overwrite x-pathname (used by the
    // support-access audit), or a client could supply its own.
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};
