import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mobileKey } from "./crypto";

/**
 * Short-lived signed URLs for files in the mobile app (gym logos now; progress photos later).
 * The signature binds the file, the user it was issued to, the gym and the expiry. URLs are
 * returned as paths, so the app prefixes whichever API host it uses (LAN IP, emulator, prod).
 * The file route still re-checks the user's access before serving anything.
 */

export const FILE_URL_TTL_SECONDS = 5 * 60;

function sign(fileId: string, userId: string, gymId: string, exp: number) {
  return createHmac("sha256", mobileKey("file-url")).update(`${fileId}|${userId}|${gymId}|${exp}`).digest("base64url");
}

export function signedFilePath(fileId: string, userId: string, gymId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + FILE_URL_TTL_SECONDS;
  const qs = new URLSearchParams({ u: userId, g: gymId, e: String(exp), s: sign(fileId, userId, gymId, exp) });
  return `/api/mobile/v1/files/${encodeURIComponent(fileId)}?${qs}`;
}

/** Returns who the URL was issued to, or null if it's tampered with or expired. */
export function verifyFileSignature(fileId: string, params: URLSearchParams, now = Date.now()): { userId: string; gymId: string } | null {
  const u = params.get("u");
  const g = params.get("g");
  const e = Number(params.get("e"));
  const s = params.get("s");
  if (!u || !g || !s || !Number.isInteger(e)) return null;
  const nowSec = Math.floor(now / 1000);
  if (e < nowSec || e > nowSec + FILE_URL_TTL_SECONDS + 60) return null;
  const expected = Buffer.from(sign(fileId, u, g, e));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { userId: u, gymId: g };
}
