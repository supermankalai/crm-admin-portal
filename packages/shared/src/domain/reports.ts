import { addDays, diffDays, isDateString, type DateString } from "./dates";

/** Reports cover at most about a year, so every query stays bounded. */
export const MAX_REPORT_DAYS = 366;
export const DEFAULT_REPORT_DAYS = 90;

export type DateRange = { from: DateString; to: DateString };

/**
 * Turn optional ?from=&to= into a valid inclusive range in the gym's calendar. Invalid or
 * missing values fall back to the last 90 days; reversed values are swapped; the end is never
 * after today and the span is capped at MAX_REPORT_DAYS (keeping the end date).
 */
export function resolveRange(from: string | undefined, to: string | undefined, today: DateString): DateRange {
  let end = to && isDateString(to) ? to : today;
  if (end > today) end = today;
  let start = from && isDateString(from) ? from : addDays(end, -(DEFAULT_REPORT_DAYS - 1));
  if (start > end) [start, end] = [end, start];
  if (diffDays(start, end) + 1 > MAX_REPORT_DAYS) start = addDays(end, -(MAX_REPORT_DAYS - 1));
  return { from: start, to: end };
}

/** Group by day for short ranges, by month for long ones, so charts stay readable. */
export function revenueGrain(range: DateRange): "day" | "month" {
  return diffDays(range.from, range.to) + 1 <= 62 ? "day" : "month";
}

/** Every bucket key in the range ("YYYY-MM-DD" days, or "YYYY-MM-01" months), so gaps show as 0. */
export function rangeBuckets(range: DateRange, grain: "day" | "month"): DateString[] {
  const out: DateString[] = [];
  if (grain === "day") {
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d);
    return out;
  }
  let [y, m] = range.from.split("-").map(Number);
  const [ey, em] = range.to.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01` as DateString);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

// ─────────────────────────────── CSV ───────────────────────────────

export type CsvCell = string | number | null | undefined;

/**
 * Spreadsheet apps execute cells that start with = + - @ (and tab / CR) as formulas, so a member
 * named "=HYPERLINK(...)" could attack whoever opens the export. Text cells that start with one
 * are prefixed with an apostrophe. Numbers are written as plain numbers.
 */
function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 CSV with CRLF line endings and a UTF-8 BOM so Excel reads ₹ and names correctly. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Money for CSV: major units with exactly two decimals, as a number column. */
export function csvMoney(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// ───────────────────────────── Attendance ─────────────────────────────

/** Days shown Monday first; values are Postgres ISO day numbers (1 = Monday … 7 = Sunday). */
export const WEEKDAYS = [
  { isoDow: 1, label: "Mon" },
  { isoDow: 2, label: "Tue" },
  { isoDow: 3, label: "Wed" },
  { isoDow: 4, label: "Thu" },
  { isoDow: 5, label: "Fri" },
  { isoDow: 6, label: "Sat" },
  { isoDow: 7, label: "Sun" },
] as const;

/** A 7 × 24 grid of check-in counts (rows Monday→Sunday, columns hour 0→23). */
export function heatmapGrid(rows: { isoDow: number; hour: number; n: number }[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of rows) {
    if (r.isoDow >= 1 && r.isoDow <= 7 && r.hour >= 0 && r.hour <= 23) grid[r.isoDow - 1][r.hour] += r.n;
  }
  return grid;
}

/** The busiest weekday/hour slot, or null when there were no check-ins. */
export function busiestSlot(grid: number[][]): { day: string; hour: number; n: number } | null {
  let best: { day: string; hour: number; n: number } | null = null;
  grid.forEach((row, d) =>
    row.forEach((n, hour) => {
      if (n > 0 && (!best || n > best.n)) best = { day: WEEKDAYS[d].label, hour, n };
    })
  );
  return best;
}

/** Hours that ever had a check-in, padded by one either side, so the grid isn't mostly empty night. */
export function activeHourSpan(grid: number[][]): { first: number; last: number } {
  let first = 24;
  let last = -1;
  for (const row of grid) {
    row.forEach((n, h) => {
      if (n > 0) {
        first = Math.min(first, h);
        last = Math.max(last, h);
      }
    });
  }
  if (last < 0) return { first: 6, last: 21 };
  return { first: Math.max(0, first - 1), last: Math.min(23, last + 1) };
}

/** Bucket a count into 0–5 intensity steps relative to the busiest cell (0 = none). */
export function intensity(n: number, max: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (n <= 0 || max <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((n / max) * 5))) as 1 | 2 | 3 | 4 | 5;
}

// ───────────────────────────── Retention ─────────────────────────────

export type RetentionMonth = {
  month: DateString;
  /** Members with an active membership on the first day of the month. */
  activeAtStart: number;
  /** Of those, still active on the last day (or today, for the current month). */
  retained: number;
  /** Active at the end but not at the start (new and returning members). */
  gained: number;
  activeAtEnd: number;
};

/** Percent with one decimal, or null when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function retentionRates(m: RetentionMonth) {
  const churned = m.activeAtStart - m.retained;
  return { churned, retentionRate: percent(m.retained, m.activeAtStart), churnRate: percent(churned, m.activeAtStart) };
}

/** Last day of the month that starts on `firstDay` ("YYYY-MM-01"). */
export function monthLastDay(firstDay: DateString): DateString {
  const [y, m] = firstDay.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) as DateString;
}

/** The last `count` month starts up to and including today's month. */
export function lastMonthStarts(today: DateString, count: number): DateString[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1)).toISOString().slice(0, 10) as DateString);
}

// ───────────────────────────── Labels ─────────────────────────────

const DAY_LABEL = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const MONTH_LABEL = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

export function bucketLabel(bucket: DateString, grain: "day" | "month"): string {
  return (grain === "day" ? DAY_LABEL : MONTH_LABEL).format(new Date(`${bucket}T00:00:00Z`));
}

export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
}

export const REPORT_KINDS = ["revenue", "attendance", "retention", "classes"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_LABELS: Record<ReportKind, string> = { revenue: "Revenue", attendance: "Attendance", retention: "Retention & churn", classes: "Class popularity" };
