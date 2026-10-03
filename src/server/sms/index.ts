import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

/**
 * Outgoing SMS behind an interface, like email. `dev-outbox` writes each message to
 * .dev-outbox/*.sms.txt; `twilio` sends through Twilio's REST API. Message bodies may contain
 * single-use codes or links, so they are never logged, and numbers are logged masked.
 */
export type SmsMessage = { to: string; text: string };

export interface SmsProvider {
  send(message: SmsMessage): Promise<void>;
}

export function maskPhone(e164: string): string {
  return `•••• ${e164.slice(-4)}`;
}

class DevOutboxSms implements SmsProvider {
  constructor(private readonly dir: string) {}

  async send(message: SmsMessage) {
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-sms-${message.to.slice(-4)}-${randomUUID().slice(0, 8)}.sms.txt`);
    await writeFile(file, `To: ${message.to}\r\nDate: ${new Date().toUTCString()}\r\n\r\n${message.text}\r\n`, "utf8");
    logger.info("sms written to dev outbox", { to: maskPhone(message.to), file: path.basename(file) });
  }
}

class TwilioSms implements SmsProvider {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string
  ) {}

  async send(message: SmsMessage) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: message.to, From: this.from, Body: message.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Twilio's error body names the problem (e.g. unverified number) without our message text.
      const detail = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
      logger.error("twilio send failed", { status: res.status, code: detail.code, to: maskPhone(message.to) });
      throw new Error("SMS could not be sent.");
    }
    logger.info("sms sent", { to: maskPhone(message.to) });
  }
}

let provider: SmsProvider | undefined;

export function getSmsProvider(): SmsProvider {
  const env = getEnv();
  provider ??=
    env.SMS_PROVIDER === "twilio" ? new TwilioSms(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!, env.TWILIO_FROM!) : new DevOutboxSms(path.resolve(".dev-outbox"));
  return provider;
}
