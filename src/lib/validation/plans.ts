import { z } from "zod";
import { parseMajorToMinor } from "@/domain/money";

const money = (label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const minor = parseMajorToMinor(v === "" ? "0" : v);
      if (minor === null) {
        ctx.addIssue({ code: "custom", message: `Enter ${label} like 2500 or 2500.50` });
        return z.NEVER;
      }
      return minor;
    });

export const PLAN_TYPES = ["MONTHLY", "QUARTERLY", "YEARLY", "CLASS_PACK"] as const;
export const DEFAULT_DURATION: Record<(typeof PLAN_TYPES)[number], number> = { MONTHLY: 30, QUARTERLY: 90, YEARLY: 365, CLASS_PACK: 60 };

export const membershipPlanSchema = z
  .object({
    planId: z.string().max(64).optional(),
    name: z.string().trim().min(2, "Enter a plan name").max(60),
    description: z
      .string()
      .trim()
      .max(300)
      .transform((v) => (v === "" ? null : v)),
    type: z.enum(PLAN_TYPES),
    price: money("a price"),
    durationDays: z.coerce.number().int().min(1, "At least 1 day").max(730, "At most 730 days"),
    classCredits: z
      .union([z.literal(""), z.coerce.number().int().min(1).max(500)])
      .transform((v) => (v === "" ? null : v)),
    allowFreeze: z.boolean(),
    maxFreezeDays: z.coerce.number().int().min(0).max(365),
    cancellationNoticeDays: z.coerce.number().int().min(0).max(90),
    cancellationFee: money("a fee"),
    isActive: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (p.type === "CLASS_PACK" && p.classCredits === null) {
      ctx.addIssue({ code: "custom", path: ["classCredits"], message: "Class packs need a number of classes" });
    }
    if (p.allowFreeze && p.maxFreezeDays < 1) {
      ctx.addIssue({ code: "custom", path: ["maxFreezeDays"], message: "Allow at least 1 freeze day, or turn freezing off" });
    }
  })
  .transform((p) => ({
    ...p,
    classCredits: p.type === "CLASS_PACK" ? p.classCredits : null,
    maxFreezeDays: p.allowFreeze ? p.maxFreezeDays : 0,
  }));

export type MembershipPlanInput = z.output<typeof membershipPlanSchema>;
export type MembershipPlanFormValues = z.input<typeof membershipPlanSchema>;

export const planIdSchema = z.object({ planId: z.string().min(1).max(64) });
