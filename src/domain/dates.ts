import { TZDate } from "@date-fns/tz";

/**
 * Calendar helpers in a gym's time zone. Memberships use calendar dates (Postgres DATE,
 * represented as "YYYY-MM-DD" strings here); instants (check-ins, payments) are UTC Dates.
 * "Today", "this month" and "expiring in 7 days" are always the GYM's local calendar.
 */

export type DateString = string; // "YYYY-MM-DD"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: string): value is DateString {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The gym-local calendar date of an instant. */
export function localDate(instant: Date, timeZone: string): DateString {
  const t = new TZDate(instant.getTime(), timeZone);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** A DATE column value (UTC midnight) ↔ "YYYY-MM-DD". */
export function toDateString(value: Date): DateString {
  return value.toISOString().slice(0, 10);
}
export function fromDateString(value: DateString): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function addDays(date: DateString, days: number): DateString {
  const d = fromDateString(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateString(d);
}

/** Whole days from a to b (b − a). */
export function diffDays(a: DateString, b: DateString): number {
  return Math.round((fromDateString(b).getTime() - fromDateString(a).getTime()) / 86_400_000);
}

/** UTC instants bounding a local calendar day: [start, end). */
export function dayBounds(date: DateString, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number);
  return {
    start: new Date(new TZDate(y, m - 1, d, 0, 0, 0, timeZone).getTime()),
    end: new Date(new TZDate(y, m - 1, d + 1, 0, 0, 0, timeZone).getTime()),
  };
}

/** UTC instants bounding the local calendar month containing `date`: [start, end). */
export function monthBounds(date: DateString, timeZone: string): { start: Date; end: Date; firstDay: DateString } {
  const [y, m] = date.split("-").map(Number);
  return {
    start: new Date(new TZDate(y, m - 1, 1, 0, 0, 0, timeZone).getTime()),
    end: new Date(new TZDate(y, m, 1, 0, 0, 0, timeZone).getTime()),
    firstDay: `${y}-${String(m).padStart(2, "0")}-01`,
  };
}

export function formatDate(date: DateString | Date, timeZone = "UTC", style: "medium" | "long" = "medium"): string {
  const instant = typeof date === "string" ? fromDateString(date) : date;
  return new Intl.DateTimeFormat("en-IN", { dateStyle: style, timeZone: typeof date === "string" ? "UTC" : timeZone }).format(instant);
}

export function formatDateTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone }).format(instant);
}

export function ageOn(dateOfBirth: DateString, today: DateString): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
