import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mobileKey } from "./crypto";

/**
 * Short-lived signed URLs for files in the mobile app: gym logos (`/files/{id}`) and progress
 * photos (`/progress-photos/{id}`). The signature binds the kind of file, its id, the user it was
 * issued to, the gym and the expiry, so a logo link can't be replayed as a photo link. URLs are
 * returned as paths, so the app prefixes whichever API host it uses (LAN IP, emulator, prod).
 * The routes still re-check the user's access before serving anything.
 */

export const FILE_URL_TTL_SECONDS = 5 * 60;

type FileKind = "file" | "photo";
const ROUTES: Record<FileKind, string> = { file: "/api/mobile/v1/files/", photo: "/api/mobile/v1/progress-photos/" };

function sign(kind: FileKind, id: string, userId: string, gymId: string, exp: number) {
  // Logo URLs keep their original message format so links issued before photos existed still verify.
  const subject = kind === "file" ? id : `photo:${id}`;
  return createHmac("sha256", mobileKey("file-url")).update(`${subject}|${userId}|${gymId}|${exp}`).digest("base64url");
}

function signedPath(kind: FileKind, id: string, userId: string, gymId: string, now: number) {
  const exp = Math.floor(now / 1000) + FILE_URL_TTL_SECONDS;
  const qs = new URLSearchParams({ u: userId, g: gymId, e: String(exp), s: sign(kind, id, userId, gymId, exp) });
  return `${ROUTES[kind]}${encodeURIComponent(id)}?${qs}`;
}

function verify(kind: FileKind, id: string, params: URLSearchParams, now: number): { userId: string; gymId: string } | null {
  const u = params.get("u");
  const g = params.get("g");
  const e = Number(params.get("e"));
  const s = params.get("s");
  if (!u || !g || !s || !Number.isInteger(e)) return null;
  const nowSec = Math.floor(now / 1000);
  if (e < nowSec || e > nowSec + FILE_URL_TTL_SECONDS + 60) return null;
  const expected = Buffer.from(sign(kind, id, u, g, e));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { userId: u, gymId: g };
}

export function signedFilePath(fileId: string, userId: string, gymId: string, now = Date.now()): string {
  return signedPath("file", fileId, userId, gymId, now);
}

/** Returns who the URL was issued to, or null if it's tampered with or expired. */
export function verifyFileSignature(fileId: string, params: URLSearchParams, now = Date.now()) {
  return verify("file", fileId, params, now);
}

export function signedPhotoPath(photoId: string, userId: string, gymId: string, now = Date.now()): string {
  return signedPath("photo", photoId, userId, gymId, now);
}

export function verifyPhotoSignature(photoId: string, params: URLSearchParams, now = Date.now()) {
  return verify("photo", photoId, params, now);
}
