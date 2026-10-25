import { formatMoney } from "@fitcrm/shared/domain/money";

/** Display helpers. Times are shown in the gym's time zone (what the gym's timetable means). */

export function money(minor: number, currency: string) {
  return formatMoney(minor, currency);
}

export function time(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

export function dayLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone }).format(new Date(iso));
}

export function dateTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

/** A "YYYY-MM-DD" calendar date (no time zone shift). */
export function date(dateOnly: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${dateOnly}T00:00:00Z`));
}

/** Gym-local calendar day of an instant, as "YYYY-MM-DD". */
export function localDay(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
