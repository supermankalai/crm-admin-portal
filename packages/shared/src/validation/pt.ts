import { z } from "zod";
import { isDateString } from "../domain/dates";
import { parseMajorToMinor } from "../domain/money";
import { round1 } from "../domain/progress";
import { PT_GOALS, PT_SESSION_MINUTES, PT_TARGET_LIMITS, type PtTargets } from "../domain/pt";
import { PAYMENT_METHODS } from "./payments";

/** Personal training module: assignments, goals and targets, PT sessions. Forms send strings. */

const id = z.string().trim().min(1).max(64);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

/** "" → null; otherwise a number (one decimal) within the range. */
const optionalMeasure = (min: number, max: number, label: string, unit: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label}: ${min}–${max} ${unit}` });
        return z.NEVER;
      }
      return round1(n);
    });

const goalFields = {
  goal: z.union([z.enum(PT_GOALS), z.literal("")]).transform((v) => (v === "" ? null : v)),
  targetWeightKg: optionalMeasure(PT_TARGET_LIMITS.weightKg.min, PT_TARGET_LIMITS.weightKg.max, "Target weight", "kg"),
  targetBodyFatPct: optionalMeasure(PT_TARGET_LIMITS.bodyFatPct.min, PT_TARGET_LIMITS.bodyFatPct.max, "Target body fat", "%"),
  targetDate: z
    .string()
    .trim()
    .refine((v) => v === "" || isDateString(v), "Choose a date")
    .transform((v) => (v === "" ? null : v)),
  note: z
    .string()
    .trim()
    .max(PT_TARGET_LIMITS.noteMax, `At most ${PT_TARGET_LIMITS.noteMax} characters`)
    .transform((v) => (v === "" ? null : v)),
};

/** Form values → the targets object that gets encrypted (null when there's nothing to keep). */
export function targetsFrom(v: { targetWeightKg: number | null; targetBodyFatPct: number | null; targetDate: string | null; note: string | null }): PtTargets | null {
  const t: PtTargets = {};
  if (v.targetWeightKg !== null) t.targetWeightKg = v.targetWeightKg;
  if (v.targetBodyFatPct !== null) t.targetBodyFatPct = v.targetBodyFatPct;
  if (v.targetDate !== null) t.targetDate = v.targetDate;
  if (v.note !== null) t.note = v.note;
  return Object.keys(t).length ? t : null;
}

export const assignTrainerSchema = z.object({ memberId: id, trainerId: id, ...goalFields });
export type AssignTrainerFormValues = z.input<typeof assignTrainerSchema>;

export const updateGoalSchema = z.object({ assignmentId: id, ...goalFields });
export type UpdateGoalFormValues = z.input<typeof updateGoalSchema>;

export const endAssignmentSchema = z.object({
  assignmentId: id,
  reason: z
    .string()
    .trim()
    .max(PT_TARGET_LIMITS.endReasonMax, `At most ${PT_TARGET_LIMITS.endReasonMax} characters`)
    .transform((v) => (v === "" ? null : v)),
});

/** Web portal: book a PT session (managers choose the trainer; trainers book for themselves). */
export const bookPtSessionSchema = z.object({
  trainerId: id.optional(),
  memberId: id,
  date: z.string().refine(isDateString, "Choose a date"),
  startTime: time,
  durationMinutes: z.coerce
    .number()
    .int()
    .min(PT_SESSION_MINUTES.min, `At least ${PT_SESSION_MINUTES.min} minutes`)
    .max(PT_SESSION_MINUTES.max, `At most ${PT_SESSION_MINUTES.max / 60} hours`),
  focus: z
    .string()
    .trim()
    .max(120, "At most 120 characters")
    .transform((v) => (v === "" ? null : v)),
  /** Managers only: book without using a package credit. */
  complimentary: z.boolean().default(false),
  /** In person, or a video call (when the gym's plan includes live sessions). */
  deliveryMode: z.enum(["IN_PERSON", "ONLINE"]).default("IN_PERSON"),
});
export type BookPtSessionFormValues = z.input<typeof bookPtSessionSchema>;

export const ptSessionStatusSchema = z.object({ sessionId: id, status: z.enum(["COMPLETED", "CANCELLED", "NO_SHOW"]) });

// ─────────────────────────────── Packages (part 2) ───────────────────────────────

export const ptPackageSchema = z.object({
  packageId: id.optional(),
  name: z.string().trim().min(2, "Name the package").max(80),
  description: z
    .string()
    .trim()
    .max(300, "At most 300 characters")
    .transform((v) => (v === "" ? null : v)),
  sessionCount: z.coerce.number().int("Whole sessions only").min(1, "At least 1 session").max(200, "At most 200 sessions"),
  price: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const minor = parseMajorToMinor(v === "" ? "0" : v);
      if (minor === null) {
        ctx.addIssue({ code: "custom", message: "Enter a price like 12000 or 12000.50" });
        return z.NEVER;
      }
      return minor;
    }),
  validityDays: z.coerce.number().int().min(1, "At least 1 day").max(730, "At most 730 days"),
  isActive: z.boolean(),
});
export type PtPackageFormValues = z.input<typeof ptPackageSchema>;
export type PtPackageInput = z.output<typeof ptPackageSchema>;

export const ptPackageIdSchema = z.object({ packageId: id });

/** Selling a package: invoice now, payment now (in full or part) or later — like a membership. */
export const sellPtPackageSchema = z
  .object({
    memberId: id,
    packageId: id,
    /** "" = sessions with any trainer. */
    trainerId: z
      .string()
      .trim()
      .max(64)
      .transform((v) => (v === "" ? null : v)),
    startsOn: z.string().trim().refine(isDateString, "Choose a start date"),
    payNow: z.enum(["full", "partial", "none"]),
    amount: z.string().trim(),
    method: z.enum(PAYMENT_METHODS),
    reference: z
      .string()
      .trim()
      .max(80)
      .transform((v) => (v === "" ? null : v)),
  })
  .superRefine((v, ctx) => {
    if (v.payNow === "partial") {
      const minor = parseMajorToMinor(v.amount);
      if (minor === null || minor <= 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter the amount received" });
    }
    if (v.payNow !== "none" && v.method === "TRANSFER" && v.reference === null) {
      ctx.addIssue({ code: "custom", path: ["reference"], message: "Add the transfer / UPI reference" });
    }
  })
  .transform((v) => ({ ...v, amountMinor: v.payNow === "partial" ? (parseMajorToMinor(v.amount) as number) : null }));
export type SellPtPackageFormValues = z.input<typeof sellPtPackageSchema>;
export type SellPtPackageInput = z.output<typeof sellPtPackageSchema>;

export const ptCreditsSettingSchema = z.object({ required: z.boolean() });
