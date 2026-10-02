import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

/**
 * Outgoing email behind an interface. `dev-outbox` writes each message to .dev-outbox/ (gitignored)
 * so invite / reset links can be opened locally. It never logs message bodies, which may contain
 * single-use tokens. Add an SMTP / SES / Postmark provider here for production.
 */
export type EmailMessage = { to: string; subject: string; text: string };

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

class DevOutboxEmail implements EmailProvider {
  constructor(private readonly dir: string, private readonly from: string) {}

  async send(message: EmailMessage) {
    await mkdir(this.dir, { recursive: true });
    const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, "_");
    const file = path.join(this.dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeTo}-${randomUUID().slice(0, 8)}.eml`);
    const body = [`From: ${this.from}`, `To: ${message.to}`, `Subject: ${message.subject}`, `Date: ${new Date().toUTCString()}`, "", message.text, ""].join("\r\n");
    await writeFile(file, body, "utf8");
    logger.info("email written to dev outbox", { to: message.to, subject: message.subject, file: path.basename(file) });
  }
}

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  const env = getEnv();
  provider ??= new DevOutboxEmail(path.resolve(".dev-outbox"), env.EMAIL_FROM);
  return provider;
}
