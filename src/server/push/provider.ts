import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { FcmPush, loadServiceAccount } from "./fcm";

/**
 * Push delivery behind an interface, like email and SMS. Each device is reached one of two ways:
 * an Expo token through Expo's push service (which forwards to Apple and Google), or an Android
 * device's native Firebase token straight through Firebase Cloud Messaging (./fcm). `live` routes
 * every message to the right one; `dev-outbox` writes each push to .dev-outbox/*.push.json so you
 * can see exactly what would have appeared on a lock screen. Tokens are never logged.
 */

export type PushMessage = {
  to: string;
  /** Which service the token belongs to. */
  provider: "expo" | "fcm";
  title: string;
  body: string;
  data: Record<string, string>;
};

/** One result per message, in order. */
export type PushTicket = { status: "ok"; id: string } | { status: "error"; error: string };
export type PushReceipt = { status: "ok" } | { status: "error"; error: string };

export interface PushProvider {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  receipts(ticketIds: string[]): Promise<Record<string, PushReceipt>>;
}

export const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/;
export const SEND_BATCH = 100;
export const RECEIPT_BATCH = 300;

export function maskToken(token: string) {
  return `${token.slice(0, 18)}…`;
}

class ExpoPush implements PushProvider {
  constructor(private readonly accessToken?: string) {}

  private headers() {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
    };
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(messages.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: "default", priority: "high", channelId: "default" }))),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: { status: string; id?: string; details?: { error?: string }; message?: string }[]; errors?: { code?: string }[] };
    if (!res.ok || !Array.isArray(json.data)) {
      logger.error("expo push send failed", { status: res.status, code: json.errors?.[0]?.code });
      throw new Error("Push service unavailable.");
    }
    return json.data.map((t) => (t.status === "ok" && t.id ? { status: "ok", id: t.id } : { status: "error", error: t.details?.error ?? "Unknown" }));
  }

  async receipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    const res = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ ids: ticketIds }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, { status: string; details?: { error?: string } }> };
    if (!res.ok || !json.data) {
      logger.error("expo push receipts failed", { status: res.status });
      throw new Error("Push service unavailable.");
    }
    return Object.fromEntries(Object.entries(json.data).map(([id, r]) => [id, r.status === "ok" ? { status: "ok" } : { status: "error", error: r.details?.error ?? "Unknown" }]));
  }
}

class DevOutboxPush implements PushProvider {
  constructor(private readonly dir: string) {}

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    await mkdir(this.dir, { recursive: true });
    const tickets: PushTicket[] = [];
    for (const m of messages) {
      const id = `dev-${randomUUID()}`;
      const file = path.join(this.dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${id.slice(4, 12)}.push.json`);
      await writeFile(file, `${JSON.stringify({ via: m.provider, to: maskToken(m.to), title: m.title, body: m.body, data: m.data }, null, 2)}\n`, "utf8");
      tickets.push({ status: "ok", id });
    }
    logger.info("push written to dev outbox", { count: messages.length });
    return tickets;
  }

  async receipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ticketIds.map((id) => [id, { status: "ok" as const }]));
  }
}

/**
 * Sends each message through its token's own service, keeping the results in order. Firebase
 * tickets are prefixed "fcm:" (see ./fcm), so receipts are asked of the right service too.
 */
export class RoutingPush implements PushProvider {
  constructor(
    private readonly expo: PushProvider,
    private readonly fcm: PushProvider | null
  ) {}

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = new Array(messages.length);
    const groups = { expo: [] as number[], fcm: [] as number[] };
    messages.forEach((m, i) => groups[m.provider].push(i));
    for (const kind of ["expo", "fcm"] as const) {
      const idx = groups[kind];
      if (!idx.length) continue;
      const service = kind === "expo" ? this.expo : this.fcm;
      if (!service) {
        logger.warn("push skipped: Firebase isn't configured (FIREBASE_SERVICE_ACCOUNT_FILE)", { count: idx.length });
        idx.forEach((i) => (tickets[i] = { status: "error", error: "FcmNotConfigured" }));
        continue;
      }
      const out = await service.send(idx.map((i) => messages[i]));
      idx.forEach((i, j) => (tickets[i] = out[j] ?? { status: "error", error: "NoTicket" }));
    }
    return tickets;
  }

  async receipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    const fcmIds = ticketIds.filter((id) => id.startsWith("fcm:"));
    const expoIds = ticketIds.filter((id) => !id.startsWith("fcm:"));
    const fromFcm = fcmIds.length && this.fcm ? await this.fcm.receipts(fcmIds) : Object.fromEntries(fcmIds.map((id) => [id, { status: "ok" as const }]));
    return { ...(expoIds.length ? await this.expo.receipts(expoIds) : {}), ...fromFcm };
  }
}

let provider: PushProvider | undefined;
export function getPushProvider(): PushProvider {
  if (provider) return provider;
  const env = getEnv();
  if (env.PUSH_PROVIDER === "dev-outbox") return (provider = new DevOutboxPush(path.resolve(".dev-outbox")));
  const fcm = env.FIREBASE_SERVICE_ACCOUNT_FILE ? new FcmPush(loadServiceAccount(path.resolve(env.FIREBASE_SERVICE_ACCOUNT_FILE))) : null;
  return (provider = new RoutingPush(new ExpoPush(env.EXPO_ACCESS_TOKEN), fcm));
}
