import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

/**
 * Push delivery behind an interface, like email and SMS. `expo` talks to Expo's push service
 * (which forwards to Apple and Google); `dev-outbox` writes each push to .dev-outbox/*.push.json
 * so you can see exactly what would have appeared on a lock screen. Tokens are never logged.
 */

export type PushMessage = {
  to: string;
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
      body: JSON.stringify(messages.map((m) => ({ ...m, sound: "default", priority: "high", channelId: "default" }))),
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
      await writeFile(file, `${JSON.stringify({ to: maskToken(m.to), title: m.title, body: m.body, data: m.data }, null, 2)}\n`, "utf8");
      tickets.push({ status: "ok", id });
    }
    logger.info("push written to dev outbox", { count: messages.length });
    return tickets;
  }

  async receipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ticketIds.map((id) => [id, { status: "ok" as const }]));
  }
}

let provider: PushProvider | undefined;
export function getPushProvider(): PushProvider {
  const env = getEnv();
  provider ??= env.PUSH_PROVIDER === "expo" ? new ExpoPush(env.EXPO_ACCESS_TOKEN) : new DevOutboxPush(path.resolve(".dev-outbox"));
  return provider;
}
