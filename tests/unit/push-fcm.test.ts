import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FCM_PUSH_TOKEN, pushTokenRequestSchema } from "@fitcrm/shared/api/schemas";
import { FcmPush, loadServiceAccount, signedAssertion, type ServiceAccount } from "@/server/push/fcm";
import { RoutingPush, type PushMessage, type PushProvider, type PushTicket } from "@/server/push/provider";

/** Firebase push without Firebase: a throwaway key and a fake network. */

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const account: ServiceAccount = { project_id: "kangafit-test", client_email: "push@kangafit-test.iam.gserviceaccount.com", private_key: privateKey, token_uri: "https://oauth2.googleapis.com/token" };
const fcmToken = `f${"A1b2_C3d-4:".repeat(14)}`;
const msg = (to: string, provider: "expo" | "fcm" = "fcm"): PushMessage => ({ to, provider, title: "Iron Temple", body: "You have a new personal trainer. Open the app to see who.", data: { notificationId: "n1", type: "PT_ASSIGNED", gymSlug: "iron-temple" } });

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const r = respond(call);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("Firebase service-account key", () => {
  it("loads a real key file and refuses anything else", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fcm-"));
    const good = path.join(dir, "sa.json");
    writeFileSync(good, JSON.stringify({ type: "service_account", ...account }));
    expect(loadServiceAccount(good)).toMatchObject({ project_id: "kangafit-test", client_email: account.client_email });
    const googleServices = path.join(dir, "google-services.json");
    writeFileSync(googleServices, JSON.stringify({ project_info: { project_id: "x" }, client: [] }));
    expect(() => loadServiceAccount(googleServices)).toThrow(/isn't a Firebase service-account key/);
    expect(() => loadServiceAccount(path.join(dir, "missing.json"))).toThrow(/can't be read/);
  });

  it("signs a JWT Google can verify, scoped to Firebase messaging for one hour", () => {
    const jwt = signedAssertion(account, 1_800_000_000);
    const [header, claims, signature] = jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: account.token_uri,
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
  });
});

describe("sending through Firebase", () => {
  it("gets an access token once, then sends a high-priority alert on the app's channel", async () => {
    const net = fakeFetch((c) => (c.url.includes("oauth2") ? { status: 200, body: { access_token: "ya29.test", expires_in: 3600 } } : { status: 200, body: { name: "projects/kangafit-test/messages/123" } }));
    const fcm = new FcmPush(account, net.impl);
    expect(await fcm.send([msg(fcmToken), msg(fcmToken)])).toEqual([
      { status: "ok", id: "fcm:projects/kangafit-test/messages/123" },
      { status: "ok", id: "fcm:projects/kangafit-test/messages/123" },
    ]);
    await fcm.send([msg(fcmToken)]);
    expect(net.calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1); // cached
    const send = net.calls.find((c) => c.url.includes("fcm.googleapis.com"))!;
    expect(send.url).toBe("https://fcm.googleapis.com/v1/projects/kangafit-test/messages:send");
    expect((send.init.headers as Record<string, string>).Authorization).toBe("Bearer ya29.test");
    expect(JSON.parse(String(send.init.body))).toEqual({
      message: {
        token: fcmToken,
        notification: { title: "Iron Temple", body: "You have a new personal trainer. Open the app to see who." },
        data: { notificationId: "n1", type: "PT_ASSIGNED", gymSlug: "iron-temple" },
        android: { priority: "HIGH", notification: { channel_id: "default", sound: "default" } },
      },
    });
  });

  it("retires uninstalled devices, but not on a malformed-message error", async () => {
    const net = fakeFetch((c) => {
      if (c.url.includes("oauth2")) return { status: 200, body: { access_token: "t", expires_in: 3600 } };
      const token = JSON.parse(String(c.init.body)).message.token as string;
      if (token.endsWith("gone")) return { status: 404, body: { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } } };
      return { status: 400, body: { error: { status: "INVALID_ARGUMENT", details: [{ errorCode: "INVALID_ARGUMENT" }] } } };
    });
    const out = await new FcmPush(account, net.impl).send([msg(`${fcmToken}gone`), msg(`${fcmToken}odd`)]);
    expect(out).toEqual([
      { status: "error", error: "DeviceNotRegistered" },
      { status: "error", error: "INVALID_ARGUMENT" },
    ]);
  });

  it("says so plainly when Google rejects the key", async () => {
    const net = fakeFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    await expect(new FcmPush(account, net.impl).send([msg(fcmToken)])).rejects.toThrow("Firebase rejected the service-account key.");
  });
});

describe("routing between Expo and Firebase", () => {
  class Recorder implements PushProvider {
    sent: PushMessage[] = [];
    constructor(private readonly prefix: string) {}
    async send(m: PushMessage[]): Promise<PushTicket[]> {
      this.sent.push(...m);
      return m.map((x) => ({ status: "ok", id: `${this.prefix}${x.to}` }));
    }
    async receipts(ids: string[]) {
      return Object.fromEntries(ids.map((id) => [id, { status: "ok" as const }]));
    }
  }

  it("sends each message through its own service and keeps the order", async () => {
    const expo = new Recorder("");
    const fcm = new Recorder("fcm:");
    const out = await new RoutingPush(expo, fcm).send([msg("ExponentPushToken[aaaaaaaaaa]", "expo"), msg("tok-b"), msg("ExponentPushToken[cccccccccc]", "expo")]);
    expect(out.map((t) => (t.status === "ok" ? t.id : t.error))).toEqual(["ExponentPushToken[aaaaaaaaaa]", "fcm:tok-b", "ExponentPushToken[cccccccccc]"]);
    expect(expo.sent).toHaveLength(2);
    expect(fcm.sent).toHaveLength(1);
  });

  it("without a Firebase key, Firebase devices are skipped (and Expo ones still sent)", async () => {
    const expo = new Recorder("");
    const out = await new RoutingPush(expo, null).send([msg("tok-a"), msg("ExponentPushToken[bbbbbbbbbb]", "expo")]);
    expect(out).toEqual([{ status: "error", error: "FcmNotConfigured" }, { status: "ok", id: "ExponentPushToken[bbbbbbbbbb]" }]);
  });
});

describe("registering a device", () => {
  it("accepts Expo tokens and Android Firebase tokens, nothing else", () => {
    expect(FCM_PUSH_TOKEN.test(fcmToken)).toBe(true);
    expect(pushTokenRequestSchema.parse({ token: "ExponentPushToken[abcdefghij]", platform: "ios" })).toMatchObject({ provider: "expo" });
    expect(pushTokenRequestSchema.safeParse({ token: fcmToken, platform: "android", provider: "fcm" }).success).toBe(true);
    expect(pushTokenRequestSchema.safeParse({ token: fcmToken, platform: "ios", provider: "fcm" }).success).toBe(false);
    expect(pushTokenRequestSchema.safeParse({ token: "short", platform: "android", provider: "fcm" }).success).toBe(false);
    expect(pushTokenRequestSchema.safeParse({ token: fcmToken, platform: "android" }).success).toBe(false); // an FCM token labelled expo
  });
});
