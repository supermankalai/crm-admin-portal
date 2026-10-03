import "server-only";
import { createHash, createHmac, hkdfSync, randomBytes, randomInt } from "node:crypto";
import { getEnv } from "@/server/env";

/**
 * Keys for the mobile API, derived from MOBILE_SECRET with HKDF so each purpose has its own
 * key: a leak or misuse in one place can't forge another kind of token.
 */
export type KeyPurpose = "access-token" | "otp" | "member-qr" | "file-url";

const cache = new Map<KeyPurpose, Buffer>();

export function mobileKey(purpose: KeyPurpose): Buffer {
  let key = cache.get(purpose);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", Buffer.from(getEnv().MOBILE_SECRET, "base64"), Buffer.alloc(0), `fitcrm-mobile:${purpose}`, 32));
    cache.set(purpose, key);
  }
  return key;
}

/** Refresh tokens and invite links: 32 random bytes; only the SHA-256 is stored. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Front-desk invite codes: 8 characters, no look-alikes (0/O, 1/I/L), shown as XXXX-XXXX. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newInviteCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Invite links and codes share one lookup: normalise codes (case, dashes, spaces) before hashing. */
export function inviteTokenHash(tokenOrCode: string): string {
  const trimmed = tokenOrCode.trim();
  const asCode = trimmed.replace(/[\s-]/g, "").toUpperCase();
  return sha256Hex(/^[A-Z0-9]{8}$/.test(asCode) ? `code:${asCode}` : `link:${trimmed}`);
}

export function inviteCodeHash(code: string): string {
  return sha256Hex(`code:${code.replace(/[\s-]/g, "").toUpperCase()}`);
}

export function inviteLinkHash(token: string): string {
  return sha256Hex(`link:${token}`);
}

/** 6-digit one-time code. */
export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * One-time codes have only a million values, so a plain hash would be reversible from a database
 * copy; an HMAC with a server key isn't. The identifier is bound in, so a code only works for the
 * identifier it was sent to.
 */
export function otpIdentifierHash(normalisedIdentifier: string): string {
  return createHmac("sha256", mobileKey("otp")).update(`id|${normalisedIdentifier}`).digest("hex");
}

export function otpCodeHash(identifierHash: string, code: string): string {
  return createHmac("sha256", mobileKey("otp")).update(`code|${identifierHash}|${code}`).digest("hex");
}
