import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-level field encryption: AES-256-GCM, random 96-bit IV, 128-bit tag.
 *
 * Stored format (single TEXT column):  v<keyVersion>.<iv>.<ciphertext>.<tag>   (base64url parts)
 *
 * The AAD binds a ciphertext to its gym, model, field and record, so a value copied into
 * another gym, column or row fails to decrypt instead of being silently accepted.
 */

export type Keyring = {
  keys: ReadonlyMap<number, Buffer>;
  activeVersion: number;
};

export type FieldContext = {
  gymId: string;
  model: string;
  field: string;
  recordId: string;
};

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]+)$/;

function aad({ gymId, model, field, recordId }: FieldContext) {
  return Buffer.from(`gym:${gymId}|${model}.${field}|${recordId}`, "utf8");
}

export function encryptWith(keyring: Keyring, plaintext: string, context: FieldContext): string {
  const key = keyring.keys.get(keyring.activeVersion);
  if (!key) throw new Error(`Active encryption key version ${keyring.activeVersion} is not loaded`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${keyring.activeVersion}`,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptWith(keyring: Keyring, stored: string, context: FieldContext): string {
  const match = FORMAT.exec(stored);
  if (!match) throw new DecryptionError("Encrypted value has an invalid format");
  const [, versionText, ivText, ctText, tagText] = match;
  const version = Number(versionText);
  const key = keyring.keys.get(version);
  if (!key) throw new DecryptionError(`Encryption key version ${version} is not loaded`);

  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new DecryptionError("Encrypted value has an invalid IV or tag");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, tampered data, or AAD mismatch (value moved between gyms/fields/rows).
    throw new DecryptionError("Encrypted value failed authentication");
  }
}

/** Key version a stored value was encrypted with, or null if it is not an encrypted value. */
export function keyVersionOf(stored: string): number | null {
  const match = FORMAT.exec(stored);
  return match ? Number(match[1]) : null;
}

export function needsRotation(keyring: Keyring, stored: string): boolean {
  const version = keyVersionOf(stored);
  return version !== null && version !== keyring.activeVersion;
}
