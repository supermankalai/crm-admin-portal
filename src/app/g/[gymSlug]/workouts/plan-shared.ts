import type { WorkoutPlanFormValues } from "@/lib/validation/fitness";

/** Shared by the workout pages (server) and the plan editor (client). */

export const PLAN_STATUS = {
  ACTIVE: { label: "Active", variant: "success" },
  DRAFT: { label: "Draft", variant: "secondary" },
  ARCHIVED: { label: "Archived", variant: "outline" },
} as const;

export const blankExercise = () => ({ name: "", sets: "3", reps: "10", restSeconds: "60", notes: "" });
export const blankDay = (n: number) => ({ title: `Day ${String.fromCharCode(65 + n)}`, exercises: [blankExercise()] });
export const BLANK_PLAN: WorkoutPlanFormValues = { title: "", notes: "", status: "ACTIVE", days: [blankDay(0)] };
