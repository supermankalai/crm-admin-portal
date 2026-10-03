import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, NetworkError } from "@fitcrm/shared/api/client";
import { api } from "@fitcrm/shared/api/contract";
import { buildOpenApiDocument } from "@fitcrm/shared/api/openapi";
import { inviteCodeHash, inviteLinkHash, inviteTokenHash, newInviteCode, otpCodeHash, otpIdentifierHash } from "@/server/mobile/crypto";
import { parseIdentifier } from "@/server/mobile/identifier";
import { signAccessToken, verifyAccessToken } from "@/server/mobile/tokens";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("access tokens", () => {
  it("round-trip, and reject tampering and expiry", async () => {
    const { token } = await signAccessToken({ sub: "u1", sid: "s1", sv: 3, gid: "g1", k: "member" });
    expect(await verifyAccessToken(token)).toEqual({ sub: "u1", sid: "s1", sv: 3, gid: "g1", k: "member" });
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), k: "staff" })).toString("base64url");
    expect(await verifyAccessToken(`${h}.${forged}.${s}`)).toBeNull();
    const old = await signAccessToken({ sub: "u1", sid: "s1", sv: 3 }, new Date(Date.now() - 16 * 60_000));
    expect(await verifyAccessToken(old.token)).toBeNull();
    expect(await verifyAccessToken("not.a.jwt")).toBeNull();
  });
});

describe("invite codes and identifiers", () => {
  it("front-desk codes are forgiving about case, dashes and spaces; links are exact", () => {
    const code = newInviteCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    const variants = [code, code.toLowerCase(), code.replace("-", ""), ` ${code.replace("-", " ")} `];
    for (const v of variants) expect(inviteTokenHash(v)).toBe(inviteCodeHash(code));
    expect(inviteTokenHash("demo-invite-token-abc")).toBe(inviteLinkHash("demo-invite-token-abc"));
    expect(inviteLinkHash("ABCDEFGH")).not.toBe(inviteCodeHash("ABCDEFGH"));
  });

  it("one-time code hashes are keyed and bound to the identifier", () => {
    const a = otpIdentifierHash("email:a@example.com");
    const b = otpIdentifierHash("email:b@example.com");
    expect(otpCodeHash(a, "123456")).not.toBe(otpCodeHash(b, "123456"));
    expect(otpCodeHash(a, "123456")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses emails and phone numbers", () => {
    expect(parseIdentifier(" Alice@Example.COM ")).toMatchObject({ kind: "email", email: "alice@example.com" });
    const p1 = parseIdentifier("098765 43210");
    const p2 = parseIdentifier("+91-98765-43210");
    expect(p1).toMatchObject({ kind: "phone", phone: "+919876543210" });
    expect(p1 && "blind" in p1 && p2 && "blind" in p2 && p1.blind === p2.blind).toBe(true);
    expect(parseIdentifier("not an email")).toBeNull();
  });
});

describe("typed API client", () => {
  it("adds the bearer token, refreshes once on 401 and retries", async () => {
    let token = "old";
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization");
      return auth === "Bearer new" ? json(200, { user: { id: "u", name: "N", email: null, phone: null }, gyms: [] }) : json(401, { error: { code: "invalid_token", message: "Sign in" } });
    });
    const refresh = vi.fn(async () => {
      token = "new";
      return true;
    });
    const client = createApiClient({ baseUrl: "https://api.test", getAccessToken: () => token, refresh, fetch: fetchMock as unknown as typeof fetch });
    const me = await client.call("me");
    expect(me.user.id).toBe("u");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/api/mobile/v1/me");
  });

  it("fills path params, surfaces API errors and offline failures", async () => {
    const fetchMock = vi.fn(async () => json(422, { error: { code: "validation", message: "Check fields", fieldErrors: { channel: ["Required"] } } }));
    const client = createApiClient({ baseUrl: "https://api.test", getAccessToken: () => "t", fetch: fetchMock as unknown as typeof fetch });
    const err = await client.call("createMemberInvite", { params: { memberId: "m 1" }, body: { channel: "CODE" } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: "validation", fieldErrors: { channel: ["Required"] } });
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("https://api.test/api/mobile/v1/staff/members/m%201/app-invite");

    const offline = createApiClient({ baseUrl: "https://api.test", getAccessToken: () => null, fetch: (async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch });
    await expect(offline.call("otpRequest", { body: { identifier: "a@b.co" } })).rejects.toBeInstanceOf(NetworkError);
  });

  it("validates responses against the contract", async () => {
    const client = createApiClient({ baseUrl: "https://api.test", getAccessToken: () => "t", fetch: (async () => json(200, { unexpected: true })) as unknown as typeof fetch });
    await expect(client.call("gym")).rejects.toThrow();
  });
});

describe("contract and OpenAPI", () => {
  it("documents every endpoint with auth and schemas", () => {
    const doc = buildOpenApiDocument("https://api.test");
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p)) as { operationId: string; security: unknown[] }[];
    expect(ops.map((o) => o.operationId).sort()).toEqual(Object.keys(api).sort());
    expect(ops.find((o) => o.operationId === "login")?.security).toEqual([]);
    expect(ops.find((o) => o.operationId === "me")?.security).toEqual([{ bearerAuth: [] }]);
  });
});
