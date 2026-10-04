import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hit } from "@/server/security/rate-limit";
import { mobileKey } from "./crypto";

/**
 * The member card's rotating QR code:  FCM2.<memberId>.<exp>.<nonce>.<sig>
 *
 *  - valid for 45 seconds (the app shows a new one every 30), so a screenshot is soon useless;
 *  - the gym is bound into the signature (not the payload), so a code only works at its own gym;
 *  - each token is accepted once: the nonce is spent on the first scan (replays are refused).
 *
 * The signature is an HMAC with a key derived only for this purpose (see mobile/crypto.ts).
 */

export const MEMBER_QR_TTL_SECONDS = 45;
export const MEMBER_QR_REFRESH_SECONDS = 30;
const CLOCK_SKEW_SECONDS = 5;
const PREFIX = "FCM2";

function sign(gymId: string, memberId: string, exp: number, nonce: string) {
  return createHmac("sha256", mobileKey("member-qr")).update(`${gymId}|${memberId}|${exp}|${nonce}`).digest("base64url").slice(0, 32);
}

export function mintMemberQr(gymId: string, memberId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + MEMBER_QR_TTL_SECONDS;
  const nonce = randomBytes(9).toString("base64url");
  return { token: `${PREFIX}.${memberId}.${exp}.${nonce}.${sign(gymId, memberId, exp, nonce)}`, expiresAt: new Date(exp * 1000) };
}

export function looksLikeMemberQr(raw: string): boolean {
  return raw.trim().startsWith(`${PREFIX}.`);
}

export type QrCheck = { ok: true; memberId: string } | { ok: false; reason: "invalid" | "expired" | "replayed" };

/** Verify a scanned token for the scanning gym and spend it (single use). */
export async function verifyMemberQr(raw: string, gymId: string, now = Date.now()): Promise<QrCheck> {
  const parts = raw.trim().split(".");
  if (parts.length !== 5 || parts[0] !== PREFIX) return { ok: false, reason: "invalid" };
  const [, memberId, expText, nonce, sig] = parts;
  const exp = Number(expText);
  if (!/^[\w-]{10,64}$/.test(memberId) || !Number.isInteger(exp) || !/^[\w-]{8,32}$/.test(nonce)) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(gymId, memberId, exp, nonce));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  if (Math.floor(now / 1000) > exp + CLOCK_SKEW_SECONDS) return { ok: false, reason: "expired" };
  // Single use: the first scan spends the nonce (kept a little longer than the token lives).
  const first = await hit({ name: "member-qr", limit: 1, windowSeconds: MEMBER_QR_TTL_SECONDS + 60 }, gymId, nonce);
  if (!first.allowed) return { ok: false, reason: "replayed" };
  return { ok: true, memberId };
}

export const QR_REJECTION: Record<"invalid" | "expired" | "replayed", string> = {
  invalid: "This QR code isn't valid at this gym.",
  expired: "This QR code has expired. Ask the member to show the live code in their app.",
  replayed: "This QR code was already used. Ask the member to show the live code in their app.",
};
