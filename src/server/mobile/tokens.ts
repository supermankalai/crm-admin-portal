import "server-only";
import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { mobileKey } from "./crypto";

/**
 * Mobile access tokens: HS256 JWTs, 15 minutes. They carry the user, the device session and the
 * user's sessionVersion; after gym selection also the gym and whether the user acts as staff or
 * as a member there. Every request re-checks all of these against the database, so a token is
 * only ever a hint that is verified — never a source of authority on its own.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = "fitcrm";
const AUDIENCE = "fitcrm-mobile";

export type AccessClaims = {
  sub: string;
  sid: string;
  sv: number;
  gid?: string;
  /** "staff" or "member" in gid. */
  k?: "staff" | "member";
};

export async function signAccessToken(claims: AccessClaims, now = new Date()) {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
  const payload: Record<string, unknown> = { sid: claims.sid, sv: claims.sv };
  if (claims.gid) {
    payload.gid = claims.gid;
    payload.k = claims.k;
  }
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(randomUUID())
    .sign(mobileKey("access-token"));
  return { token, expiresAt: new Date(exp * 1000) };
}

/** Returns the claims, or null for anything invalid/expired/tampered (callers answer 401). */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, mobileKey("access-token"), { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"], clockTolerance: 5 });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || typeof payload.sv !== "number") return null;
    const gid = typeof payload.gid === "string" ? payload.gid : undefined;
    const k = payload.k === "staff" || payload.k === "member" ? payload.k : undefined;
    if (gid && !k) return null;
    return { sub: payload.sub, sid: payload.sid, sv: payload.sv, gid, k };
  } catch {
    return null;
  }
}
