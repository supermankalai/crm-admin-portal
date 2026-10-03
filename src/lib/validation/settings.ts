import { z } from "zod";
import { normalisePhone } from "@/domain/phone";
import { emailSchema } from "./auth";

const id = z.string().trim().min(1).max(64);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

/** Currencies with two minor-unit digits (money is stored in minor units everywhere). */
export const CURRENCIES = [
  { code: "INR", label: "Indian rupee (₹)" },
  { code: "USD", label: "US dollar ($)" },
  { code: "EUR", label: "Euro (€)" },
  { code: "GBP", label: "British pound (£)" },
  { code: "AED", label: "UAE dirham" },
  { code: "SGD", label: "Singapore dollar" },
  { code: "AUD", label: "Australian dollar" },
  { code: "CAD", label: "Canadian dollar" },
] as const;
const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [string, ...string[]];

/**
 * IANA time zones for the picker. The runtime's list uses ICU's canonical names (it may list
 * "Asia/Calcutta" but not "Asia/Kolkata"), so the gym's current zone and UTC are always added.
 */
export function timeZones(current?: string): string[] {
  const list = new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []);
  list.add("UTC");
  if (current && isTimeZone(current)) list.add(current);
  return [...list].sort();
}

/** Any IANA zone name (including aliases such as Asia/Kolkata) that the runtime can use. */
export function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** "18", "18.5", "7.25" (percent) → basis points. Two decimals at most, 0–100 %. */
export function parseTaxPercent(input: string): number | null {
  const v = input.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

export function formatTaxPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

export const gymProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter the gym's name").max(80),
  email: z
    .string()
    .trim()
    .max(254)
    .transform((v) => (v === "" ? null : v))
    .pipe(emailSchema.nullable()),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === "" || normalisePhone(v) !== null, "Enter a valid phone number")
    .transform((v) => (v === "" ? null : v)),
  address: optionalText(300),
  timezone: z.string().refine(isTimeZone, "Choose a time zone"),
  currency: z.enum(CURRENCY_CODES, "Choose a currency"),
  taxRate: z
    .string()
    .refine((v) => parseTaxPercent(v) !== null, "Enter a percentage between 0 and 100, e.g. 18")
    .transform((v) => parseTaxPercent(v)!),
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const daySchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    isClosed: z.boolean(),
    open: z.string().regex(HHMM, "Use HH:MM"),
    close: z.string().regex(HHMM, "Use HH:MM").or(z.literal("24:00")),
  })
  .refine((d) => d.isClosed || (d.close === "24:00" ? 1440 : toMinutes(d.close)) > toMinutes(d.open), { message: "Closing time must be after opening time", path: ["close"] })
  .transform((d) => ({ dayOfWeek: d.dayOfWeek, isClosed: d.isClosed, openMinute: toMinutes(d.open), closeMinute: d.close === "24:00" ? 1440 : toMinutes(d.close) }));

export const openingHoursSchema = z.object({
  locationId: id,
  days: z
    .array(daySchema)
    .length(7)
    .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === 7, "Each day of the week must appear once"),
});

export const locationSchema = z.object({
  locationId: id.optional(),
  name: z.string().trim().min(2, "Enter a name").max(60),
  address: optionalText(300),
});

export const brandingSchema = z.object({
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour like #ea580c").transform((v) => v.toLowerCase()),
});

export function minutesToHHMM(minutes: number): string {
  if (minutes >= 1440) return "24:00";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
