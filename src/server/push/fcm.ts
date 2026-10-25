import "server-only";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { logger } from "@/server/logger";
import type { PushMessage, PushProvider, PushReceipt, PushTicket } from "./provider";

/**
 * Firebase Cloud Messaging, HTTP v1, for Android devices that registered their native FCM token.
 * Authenticates with a service-account key (a file outside git, FIREBASE_SERVICE_ACCOUNT_FILE):
 * a short-lived OAuth token is minted from a signed JWT and cached. The key, the access token and
 * device tokens are never logged.
 */

export type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri: string };

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const CONCURRENCY = 10;

export function loadServiceAccount(file: string): ServiceAccount {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_FILE can't be read as JSON.");
  }
  const a = raw as Partial<ServiceAccount> & { type?: string };
  if (a.type !== "service_account" || !a.project_id || !a.client_email || !a.private_key?.includes("PRIVATE KEY")) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_FILE isn't a Firebase service-account key (Project settings → Service accounts → Generate new private key).");
  }
  return { project_id: a.project_id, client_email: a.client_email, private_key: a.private_key, token_uri: a.token_uri ?? "https://oauth2.googleapis.com/token" };
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** The signed JWT Google exchanges for an access token (RFC 7523). */
export function signedAssertion(account: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: account.token_uri, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(account.private_key))}`;
}

/**
 * FCM's error codes for a token that will never work again. (Not INVALID_ARGUMENT: it also means
 * a malformed message, and one bad payload mustn't retire every device.)
 */
const GONE = new Set(["UNREGISTERED", "SENDER_ID_MISMATCH"]);

export class FcmPush implements PushProvider {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.token;
    const res = await this.fetchImpl(this.account.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedAssertion(this.account) }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !json.access_token) {
      logger.error("fcm auth failed", { status: res.status, error: json.error });
      throw new Error("Firebase rejected the service-account key.");
    }
    this.cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }

  private async sendOne(m: PushMessage, accessToken: string): Promise<PushTicket> {
    const res = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.project_id)}/messages:send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        message: {
          token: m.to,
          notification: { title: m.title, body: m.body },
          data: m.data,
          android: { priority: "HIGH", notification: { channel_id: "default", sound: "default" } },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { name?: string };
      return { status: "ok", id: `fcm:${json.name ?? "sent"}` };
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { status?: string; details?: { errorCode?: string }[] } };
    const code = json.error?.details?.find((d) => d.errorCode)?.errorCode ?? json.error?.status ?? `HTTP_${res.status}`;
    // Same word the Expo path uses, so the job retires the token the same way.
    return { status: "error", error: GONE.has(code) ? "DeviceNotRegistered" : code };
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (!messages.length) return [];
    const accessToken = await this.accessToken();
    const tickets: PushTicket[] = new Array(messages.length);
    for (let i = 0; i < messages.length; i += CONCURRENCY) {
      const batch = messages.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((m) => this.sendOne(m, accessToken).catch((): PushTicket => ({ status: "error", error: "NetworkError" }))));
      results.forEach((t, j) => (tickets[i + j] = t));
    }
    const failed = tickets.filter((t) => t.status === "error").length;
    logger.info("fcm push sent", { count: messages.length, failed });
    return tickets;
  }

  /** FCM confirms delivery to Google when it accepts the message; there are no later receipts. */
  async receipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ticketIds.map((id) => [id, { status: "ok" as const }]));
  }
}
