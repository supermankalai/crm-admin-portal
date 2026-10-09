/**
 * Body measurements a member (or their trainer) tracks over time. Values are stored encrypted on
 * the server as one JSON object per day; these rules are shared by the API and the app.
 */

export const MEASUREMENTS = [
  { key: "weightKg", label: "Weight", unit: "kg", min: 20, max: 400 },
  { key: "bodyFatPct", label: "Body fat", unit: "%", min: 2, max: 75 },
  { key: "chestCm", label: "Chest", unit: "cm", min: 30, max: 250 },
  { key: "waistCm", label: "Waist", unit: "cm", min: 30, max: 250 },
  { key: "hipsCm", label: "Hips", unit: "cm", min: 30, max: 250 },
  { key: "armCm", label: "Arm", unit: "cm", min: 10, max: 100 },
  { key: "thighCm", label: "Thigh", unit: "cm", min: 20, max: 150 },
] as const;

export type MeasurementKey = (typeof MEASUREMENTS)[number]["key"];
export type Measurements = Partial<Record<MeasurementKey, number>>;
export const MEASUREMENT_KEYS = MEASUREMENTS.map((m) => m.key) as MeasurementKey[];

export type ProgressPoint = { recordedOn: string; values: Measurements };

/** One metric over time, oldest first, skipping days it wasn't measured. */
export function seriesFor(entries: readonly ProgressPoint[], key: MeasurementKey): { date: string; value: number }[] {
  return [...entries]
    .filter((e) => typeof e.values[key] === "number")
    .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn))
    .map((e) => ({ date: e.recordedOn, value: e.values[key] as number }));
}

/** Latest value of each metric and its change since the first measurement. */
export function progressSummary(entries: readonly ProgressPoint[]) {
  return MEASUREMENTS.flatMap((m) => {
    const s = seriesFor(entries, m.key);
    if (s.length === 0) return [];
    const latest = s[s.length - 1];
    return [{ key: m.key, label: m.label, unit: m.unit, latest: latest.value, latestOn: latest.date, change: s.length > 1 ? round1(latest.value - s[0].value) : null, since: s[0].date }];
  });
}

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}
