import { createHmac } from "node:crypto";

/**
 * Blind index for exact-match search on encrypted fields.
 *
 *   <version>.<hex HMAC-SHA256(key, "<gymId>|<field>|<normalised value>")>
 *
 * Scoped by gym, so the same phone number in two gyms yields unrelated tokens.
 * Uses a key separate from the encryption keys.
 */

export type BlindIndexKey = { key: Buffer; version: number };

export function blindIndexWith(
  { key, version }: BlindIndexKey,
  gymId: string,
  field: string,
  normalisedValue: string
): string {
  const mac = createHmac("sha256", key).update(`${gymId}|${field}|${normalisedValue}`, "utf8").digest("hex");
  return `${version}.${mac}`;
}
