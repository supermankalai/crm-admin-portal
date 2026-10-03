import "server-only";
import { normalisePhone } from "@/domain/phone";
import { emailSchema } from "@/lib/validation/auth";
import { userPhoneBlindIndex } from "@/server/crypto";

/** A login identifier is an email address or a phone number. */
export type Identifier = { kind: "email"; email: string; normalised: string } | { kind: "phone"; phone: string; blind: string; normalised: string };

export function parseIdentifier(raw: string): Identifier | null {
  const value = raw.trim();
  if (value.includes("@")) {
    const parsed = emailSchema.safeParse(value);
    return parsed.success ? { kind: "email", email: parsed.data, normalised: `email:${parsed.data}` } : null;
  }
  const phone = normalisePhone(value);
  if (!phone) return null;
  return { kind: "phone", phone, blind: userPhoneBlindIndex(phone)!, normalised: `phone:${phone}` };
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}
