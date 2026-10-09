import { z } from "zod";
import { isDateString } from "../domain/dates";
import { MEASUREMENTS, round1, type Measurements } from "../domain/progress";

/** Workout plans, workout logging, progress, trainer notes and PT sessions. Forms send strings. */

const id = z.string().trim().min(1).max(64);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((v) => (v === "" ? null : v));

/** "" → null; otherwise a whole number within the range. */
const optionalInt = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label}: a whole number from ${min} to ${max}` });
        return z.NEVER;
      }
      return n;
    });

// ─────────────────────────────── Workout plans ───────────────────────────────

export const exerciseSchema = z.object({
  name: z.string().trim().min(1, "Name the exercise").max(120),
  sets: optionalInt(1, 100, "Sets"),
  reps: optionalText(20),
  restSeconds: optionalInt(0, 3600, "Rest"),
  notes: optionalText(500),
});

export const planDaySchema = z.object({
  title: z.string().trim().min(1, "Name the day").max(80),
  exercises: z.array(exerciseSchema).min(1, "Add at least one exercise").max(30, "At most 30 exercises a day"),
});

export const workoutPlanSchema = z.object({
  title: z.string().trim().min(1, "Give the plan a title").max(120),
  notes: optionalText(2000),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  days: z.array(planDaySchema).min(1, "Add at least one day").max(14, "At most 14 days"),
});
export type WorkoutPlanInput = z.output<typeof workoutPlanSchema>;
export type WorkoutPlanFormValues = z.input<typeof workoutPlanSchema>;

/** Creating a plan: for a client straight away, or as a template (no member). */
export const createWorkoutPlanSchema = workoutPlanSchema.extend({ memberId: id.nullable() });

export const assignPlanSchema = z.object({ memberId: id });

export const completeWorkoutSchema = z.object({ note: optionalText(500) });

// ─────────────────────────────── Progress ───────────────────────────────

const measurementFields = Object.fromEntries(
  MEASUREMENTS.map((m) => [
    m.key,
    z
      .string()
      .trim()
      .transform((v, ctx) => {
        if (v === "") return null;
        const n = Number(v.replace(",", "."));
        if (!Number.isFinite(n) || n < m.min || n > m.max) {
          ctx.addIssue({ code: "custom", message: `${m.label}: ${m.min}–${m.max} ${m.unit}` });
          return z.NEVER;
        }
        return round1(n);
      }),
  ])
) as Record<(typeof MEASUREMENTS)[number]["key"], z.ZodPipe<z.ZodString, z.ZodTransform<number | null, string>>>;

export const progressEntrySchema = z
  .object({
    recordedOn: z.string().trim().refine(isDateString, "Choose a date"),
    ...measurementFields,
  })
  .refine((v) => MEASUREMENTS.some((m) => v[m.key] !== null), { message: "Enter at least one measurement", path: ["weightKg"] })
  .transform(({ recordedOn, ...rest }) => ({
    recordedOn,
    values: Object.fromEntries(Object.entries(rest).filter(([, n]) => n !== null)) as Measurements,
  }));
export type ProgressEntryFormValues = z.input<typeof progressEntrySchema>;

export const progressPhotoSchema = z.object({ takenOn: z.string().trim().refine(isDateString, "Choose a date") });

// ─────────────────────────────── Trainer ───────────────────────────────

export const trainerNoteSchema = z.object({ body: z.string().trim().min(1, "Write a note").max(2000) });

export const trainingSessionSchema = z.object({
  memberId: id,
  startsAt: z.string().datetime({ offset: true, message: "Choose a start time" }),
  durationMinutes: z.coerce.number().int().min(15, "At least 15 minutes").max(240, "At most 4 hours"),
  focus: optionalText(120),
});

export const trainingSessionUpdateSchema = z.object({ status: z.enum(["COMPLETED", "CANCELLED", "NO_SHOW"]) });

export const attendanceSchema = z.object({ attended: z.boolean() });
