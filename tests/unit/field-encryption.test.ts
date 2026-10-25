import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { blindIndexWith } from "@/server/crypto/blind-index";
import {
  DecryptionError,
  decryptWith,
  encryptWith,
  keyVersionOf,
  needsRotation,
  type FieldContext,
  type Keyring,
} from "@/server/crypto/field-encryption";

const key1 = randomBytes(32);
const key2 = randomBytes(32);
const keyringV1: Keyring = { keys: new Map([[1, key1]]), activeVersion: 1 };
const keyringV2: Keyring = { keys: new Map([[1, key1], [2, key2]]), activeVersion: 2 };
const ctx: FieldContext = { gymId: "gym_a", model: "Member", field: "phone", recordId: "mem_1" };

describe("field encryption (AES-256-GCM)", () => {
  it("round-trips UTF-8 plaintext", () => {
    const value = "+91 98765 43210 · Ünïcødé ✓";
    expect(decryptWith(keyringV1, encryptWith(keyringV1, value, ctx), ctx)).toBe(value);
  });

  it("stores the key version next to the ciphertext and never the plaintext", () => {
    const stored = encryptWith(keyringV1, "secret health note", ctx);
    expect(stored).toMatch(/^v1\.[\w-]+\.[\w-]*\.[\w-]+$/);
    expect(stored).not.toContain("secret");
    expect(keyVersionOf(stored)).toBe(1);
  });

  it("uses a fresh IV every time", () => {
    expect(encryptWith(keyringV1, "same", ctx)).not.toBe(encryptWith(keyringV1, "same", ctx));
  });

  it("rejects tampered ciphertext", () => {
    const [v, iv, ct, tag] = encryptWith(keyringV1, "hello world", ctx).split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 0xff;
    expect(() => decryptWith(keyringV1, [v, iv, flipped.toString("base64url"), tag].join("."), ctx)).toThrow(DecryptionError);
  });

  it.each([
    ["another gym", { ...ctx, gymId: "gym_b" }],
    ["another field", { ...ctx, field: "address" }],
    ["another record", { ...ctx, recordId: "mem_2" }],
  ])("refuses to decrypt a value moved to %s (AAD binding)", (_label, other) => {
    const stored = encryptWith(keyringV1, "+919876543210", ctx);
    expect(() => decryptWith(keyringV1, stored, other)).toThrow(DecryptionError);
  });

  it("supports key rotation: old values still decrypt, new values use the active key", () => {
    const old = encryptWith(keyringV1, "legacy", ctx);
    expect(decryptWith(keyringV2, old, ctx)).toBe("legacy");
    expect(needsRotation(keyringV2, old)).toBe(true);

    const fresh = encryptWith(keyringV2, "new", ctx);
    expect(keyVersionOf(fresh)).toBe(2);
    expect(needsRotation(keyringV2, fresh)).toBe(false);
  });

  it("fails clearly when the key version is not loaded", () => {
    const stored = encryptWith(keyringV2, "x", ctx);
    expect(() => decryptWith(keyringV1, stored, ctx)).toThrow(/version 2 is not loaded/);
  });

  it("rejects malformed values", () => {
    expect(() => decryptWith(keyringV1, "not-encrypted", ctx)).toThrow(DecryptionError);
    expect(keyVersionOf("plain text")).toBeNull();
  });

  it("refuses to encrypt when the active key is missing", () => {
    expect(() => encryptWith({ keys: new Map(), activeVersion: 1 }, "x", ctx)).toThrow(/not loaded/);
  });
});

describe("blind index (HMAC-SHA256)", () => {
  const bk = { key: randomBytes(32), version: 1 };

  it("is deterministic for the same gym, field and value", () => {
    expect(blindIndexWith(bk, "gym_a", "phone", "+919876543210")).toBe(blindIndexWith(bk, "gym_a", "phone", "+919876543210"));
  });

  it("differs between gyms, so tokens cannot be correlated across tenants", () => {
    expect(blindIndexWith(bk, "gym_a", "phone", "+919876543210")).not.toBe(blindIndexWith(bk, "gym_b", "phone", "+919876543210"));
  });

  it("is versioned and does not contain the value", () => {
    const token = blindIndexWith(bk, "gym_a", "phone", "+919876543210");
    expect(token).toMatch(/^1\.[0-9a-f]{64}$/);
    expect(token).not.toContain("9876543210");
  });
});
