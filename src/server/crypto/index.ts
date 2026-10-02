import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { normalisePhone } from "@/domain/phone";
import { blindIndexWith, type BlindIndexKey } from "./blind-index";
import { decryptWith, encryptWith, needsRotation, type FieldContext, type Keyring } from "./field-encryption";

/**
 * The single entry point the app and the seed use for encrypting personal data.
 * Keys come from the validated environment.
 */

export type { FieldContext } from "./field-encryption";
export { DecryptionError } from "./field-encryption";

let keyring: Keyring | undefined;
let blindKey: BlindIndexKey | undefined;

function getKeyring(): Keyring {
  const env = getEnv();
  keyring ??= { keys: env.ENCRYPTION_KEYS, activeVersion: env.ENCRYPTION_ACTIVE_KEY_VERSION };
  return keyring;
}

function getBlindKey(): BlindIndexKey {
  const env = getEnv();
  blindKey ??= { key: Buffer.from(env.BLIND_INDEX_KEY, "base64"), version: env.BLIND_INDEX_KEY_VERSION };
  return blindKey;
}

export function encryptField(plaintext: string, context: FieldContext): string {
  return encryptWith(getKeyring(), plaintext, context);
}

export function decryptField(stored: string, context: FieldContext): string {
  return decryptWith(getKeyring(), stored, context);
}

export function encryptOptional(plaintext: string | null | undefined, context: FieldContext): string | null {
  return plaintext ? encryptField(plaintext, context) : null;
}

export function decryptOptional(stored: string | null | undefined, context: FieldContext): string | null {
  return stored ? decryptField(stored, context) : null;
}

export function encryptJson(value: unknown, context: FieldContext): string {
  return encryptField(JSON.stringify(value), context);
}

export function decryptJson<T>(stored: string, context: FieldContext): T {
  return JSON.parse(decryptField(stored, context)) as T;
}

export function isStale(stored: string): boolean {
  return needsRotation(getKeyring(), stored);
}

/** Blind index for a phone number, or null when the input has no digits. */
export function phoneBlindIndex(gymId: string, rawPhone: string | null | undefined): string | null {
  const normalised = rawPhone ? normalisePhone(rawPhone) : null;
  return normalised ? blindIndexWith(getBlindKey(), gymId, "phone", normalised) : null;
}

/**
 * For display paths: a single unreadable value (corrupted, or encrypted with a key that is no
 * longer loaded) must not take the whole page down. Logs the failure (never the value) and
 * returns null; callers show a placeholder.
 */
export function tryDecrypt(stored: string | null | undefined, context: FieldContext): string | null {
  if (!stored) return null;
  try {
    return decryptField(stored, context);
  } catch (error) {
    logger.error("field decryption failed", { model: context.model, field: context.field, recordId: context.recordId, gymId: context.gymId, error: (error as Error).message });
    return null;
  }
}
