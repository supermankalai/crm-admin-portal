import { fakerEN_IN as faker } from "@faker-js/faker";
import { TZDate } from "@date-fns/tz";

/** Fixed seed: the same people, plans and activity every run (dates are relative to today). */
export const FAKER_SEED = 20261002;
faker.seed(FAKER_SEED);
export { faker };

export const TIMEZONE = "Asia/Kolkata";

/** Deterministic 24-char ids in the same shape as cuid2 (lowercase, starts with a letter). */
export function id(): string {
  return faker.string.alpha({ length: 1, casing: "lower" }) + faker.string.alphanumeric({ length: 23, casing: "lower" });
}

export function chance(probability: number): boolean {
  return faker.number.float({ min: 0, max: 1 }) < probability;
}

export function int(min: number, max: number): number {
  return faker.number.int({ min, max });
}

export function pick<T>(items: readonly T[]): T {
  return items[int(0, items.length - 1)];
}

export function weighted<T>(entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = faker.number.float({ min: 0, max: total });
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

export function sample<T>(items: readonly T[], count: number): T[] {
  return faker.helpers.arrayElements(items as T[], Math.min(count, items.length));
}

// ───────────── Time helpers (gym-local calendar days as offsets from today) ─────────────

const now = new TZDate(Date.now(), TIMEZONE);
const today = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };

/** Calendar parts of the local day `offset` days from today (negative = past). */
export function localDay(offset: number) {
  const date = new TZDate(today.y, today.m, today.d + offset, 12, 0, TIMEZONE);
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate(), dow: date.getDay() };
}

/** Value for a Postgres DATE column (UTC midnight of the local calendar day). */
export function dateOnly(offset: number): Date {
  const { y, m, d } = localDay(offset);
  return new Date(Date.UTC(y, m, d));
}

/** Instant at local wall-clock time `hour:minute` on day `offset`. */
export function at(offset: number, hour: number, minute = 0): Date {
  const { y, m, d } = localDay(offset);
  return new Date(new TZDate(y, m, d, hour, minute, TIMEZONE).getTime());
}

export const NOW = new Date(now.getTime());

/** Run createMany in chunks to keep statements a reasonable size. */
export async function insertMany<T>(
  label: string,
  rows: T[],
  create: (chunk: T[]) => Promise<unknown>,
  chunkSize = 1000
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await create(rows.slice(i, i + chunkSize));
  }
  if (rows.length) console.log(`    ${label.padEnd(22)} ${rows.length}`);
}

/**
 * Clamp an instant that must already have happened to just before now.
 * Deliberately does not draw from faker, so the time of day the seed runs never changes
 * the random sequence (and therefore the generated data).
 */
export function past(date: Date): Date {
  const latest = NOW.getTime() - 60_000;
  return date.getTime() > latest ? new Date(latest) : date;
}
