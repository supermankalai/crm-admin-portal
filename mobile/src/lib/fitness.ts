import { TZDate } from "@date-fns/tz";
import { MEASUREMENTS, type MeasurementKey } from "@fitcrm/shared/domain/progress";
import type { WorkoutPlanFormValues } from "@fitcrm/shared/validation/fitness";
import type { PlanDetail, ScheduleItem } from "./fitness-queries";

/** Display rules for workouts, progress and the trainer schedule (kept testable, out of screens). */

export function exerciseLine(e: { sets: number | null; reps: string | null; restSeconds: number | null }) {
  const parts = [e.sets && e.reps ? `${e.sets} × ${e.reps}` : e.sets ? `${e.sets} sets` : e.reps ?? null, e.restSeconds ? `rest ${restText(e.restSeconds)}` : null];
  return parts.filter(Boolean).join(" · ");
}

export function restText(seconds: number) {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : seconds > 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
}

export function measurementMeta(key: MeasurementKey) {
  return MEASUREMENTS.find((m) => m.key === key)!;
}

export function formatValue(key: MeasurementKey, value: number) {
  return `${value} ${measurementMeta(key).unit}`;
}

/** "−2.4 kg" / "+1 cm" / "no change" — the sign is spelled out, never colour alone. */
export function changeText(key: MeasurementKey, change: number | null) {
  if (change === null) return null;
  if (change === 0) return "no change";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)} ${measurementMeta(key).unit}`;
}

export const emptyProgressForm = (recordedOn: string) => ({ recordedOn, weightKg: "", bodyFatPct: "", chestCm: "", waistCm: "", hipsCm: "", armCm: "", thighCm: "" });

/** A saved plan as form values (numbers back to the strings forms edit). */
export function planToForm(p: PlanDetail): WorkoutPlanFormValues {
  return {
    title: p.title,
    notes: p.notes ?? "",
    status: p.status,
    days: p.days.map((d) => ({
      title: d.title,
      exercises: d.exercises.map((e) => ({ name: e.name, sets: e.sets?.toString() ?? "", reps: e.reps ?? "", restSeconds: e.restSeconds?.toString() ?? "", notes: e.notes ?? "" })),
    })),
  };
}

export const blankExercise = () => ({ name: "", sets: "3", reps: "10", restSeconds: "60", notes: "" });
export const blankDay = (n: number) => ({ title: `Day ${String.fromCharCode(65 + n)}`, exercises: [blankExercise()] });
export const blankPlan = (): WorkoutPlanFormValues => ({ title: "", notes: "", status: "ACTIVE", days: [blankDay(0)] });

export function scheduleTitle(item: ScheduleItem) {
  if (item.kind === "class") return item.title;
  if (item.kind === "pt") return `PT · ${item.member.name}`;
  return `Shift · ${item.location}`;
}

export function scheduleSubtitle(item: ScheduleItem) {
  if (item.kind === "class") return `${item.room} · ${item.booked}/${item.capacity} booked${item.status === "CANCELLED" ? " · cancelled" : ""}`;
  if (item.kind === "pt") return [item.focus, PT_STATUS[item.status as keyof typeof PT_STATUS]?.label].filter(Boolean).join(" · ");
  return "On shift";
}

export const PT_STATUS = {
  SCHEDULED: { label: "Scheduled", tone: "sky" },
  COMPLETED: { label: "Done", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "zinc" },
  NO_SHOW: { label: "No-show", tone: "red" },
} as const;

/** Linear scale for the progress chart, padded so the line never touches the edges. */
export function chartScale(values: number[], height: number, pad = 0.12) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max) * 0.05, 1);
  const lo = min - span * pad;
  const hi = max + span * pad;
  return { lo, hi, y: (v: number) => height - ((v - lo) / (hi - lo)) * height };
}

/** "2026-10-09" + "07:30" in the gym's time zone → ISO instant, or null if either is invalid. */
export function localToIso(day: string, hhmm: string, timeZone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!d || !t || Number(t[1]) > 23 || Number(t[2]) > 59) return null;
  const at = new TZDate(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), timeZone);
  return Number.isNaN(at.getTime()) || at.getDate() !== Number(d[3]) ? null : new Date(at.getTime()).toISOString();
}

/** Has this session started? (For event handlers — reads the clock.) */
export function hasStarted(iso: string, now = Date.now()) {
  return new Date(iso).getTime() <= now;
}
