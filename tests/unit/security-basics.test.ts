import { describe, expect, it } from "vitest";
import { normalisePhone } from "@/domain/phone";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/server/auth/password";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { redact } from "@/server/logger";
import { newPasswordSchema } from "@/lib/validation/auth";

describe("password hashing", () => {
  it("uses argon2id and verifies correctly", async () => {
    const hash = await hashPassword("Correct-Horse-9");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).toContain("m=19456,t=2,p=1");
    expect(await verifyPassword(hash, "Correct-Horse-9")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });

  it("never throws on a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });

  it("dummy verification always fails (timing equalisation for unknown emails)", async () => {
    expect(await verifyAgainstDummy("anything")).toBe(false);
  });

  it("enforces the new-password policy", () => {
    expect(newPasswordSchema.safeParse("short").success).toBe(false);
    expect(newPasswordSchema.safeParse("alllowercase123").success).toBe(false);
    expect(newPasswordSchema.safeParse("Valid-Passw0rd").success).toBe(true);
  });
});

describe("phone normalisation for blind indexes", () => {
  it.each([
    ["+91 98765 43210", "+919876543210"],
    ["98765-43210", "+919876543210"],
    ["098765 43210", "+919876543210"],
    ["0091 9876543210", "+919876543210"],
    ["+1 (415) 555-0100", "+14155550100"],
  ])("%s → %s", (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it("rejects input without enough digits", () => {
    expect(normalisePhone("call me")).toBeNull();
    expect(normalisePhone("123")).toBeNull();
  });
});

describe("log redaction", () => {
  it("masks secrets and personal data by key, at any depth", () => {
    const out = redact({
      password: "p",
      user: { email: "a@b.c", phone: "+91", healthNotes: "x", nested: { token: "t", phoneEnc: "v1..." } },
      authorization: "Bearer x",
      action: "member.create",
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/"p"|\+91|Bearer|v1\.\.\.|"t"/);
    expect(out.action).toBe("member.create");
  });
});

describe("post-login redirect", () => {
  // Browsers strip tab/CR/LF from URLs, so "/\t/evil.example" would otherwise become "//evil.example".
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r//evil.example", "/ /evil.example", 42, undefined])("rejects %j", (value) => {
    expect(safeRedirectPath(value, "/")).toBe("/");
  });

  it("allows same-origin paths", () => {
    expect(safeRedirectPath("/g/iron-temple/members?page=2")).toBe("/g/iron-temple/members?page=2");
  });
});

describe("client IP from X-Forwarded-For", () => {
  it("trusts only the configured number of proxy hops, counted from the right", async () => {
    const { clientIp } = await import("@/lib/client-ip");
    // One proxy that appends: the client may have sent a fake first entry.
    expect(clientIp("6.6.6.6, 203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientIp("6.6.6.6, 203.0.113.9, 10.0.0.2", 2)).toBe("203.0.113.9");
    expect(clientIp("203.0.113.9", 2)).toBeNull(); // shorter than the proxy chain: not trustworthy
    expect(clientIp("203.0.113.9", 0)).toBeNull();
    expect(clientIp(null, 1)).toBeNull();
    expect(clientIp("not-an-ip", 1)).toBeNull();
    expect(clientIp("::ffff:127.0.0.1", 1)).toBe("127.0.0.1");
    expect(clientIp("[2001:db8::1]", 1)).toBe("2001:db8::1");
  });
});
