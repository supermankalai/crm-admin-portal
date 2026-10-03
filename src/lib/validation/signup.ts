import { z } from "zod";
import { slugProblem } from "@/domain/slug";
import { emailSchema, newPasswordSchema } from "./auth";

import { CURRENCY_CODES, isTimeZone } from "./settings";

/** Same lists as gym settings, so a gym can always be saved with what it signed up with. */
export const SUPPORTED_CURRENCIES = CURRENCY_CODES;

const timezone = z.string().min(1).refine(isTimeZone, "Choose a valid time zone");

export const gymDetailsSchema = z.object({
  gymName: z.string().trim().min(2, "Enter your gym's name").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .superRefine((value, ctx) => {
      const problem = slugProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  timezone,
  currency: z.enum(SUPPORTED_CURRENCIES),
});

export const ownerAccountSchema = z
  .object({
    ownerName: z.string().trim().min(2, "Enter your full name").max(80),
    email: emailSchema,
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export const planChoiceSchema = z.object({
  planCode: z.string().trim().toUpperCase().regex(/^[A-Z_]{2,20}$/, "Choose a plan"),
});

/** Full payload for a new user. Logged-in users skip the owner step (their account is used). */
export const signupNewUserSchema = gymDetailsSchema.and(ownerAccountSchema).and(planChoiceSchema);
export const signupExistingUserSchema = gymDetailsSchema.and(planChoiceSchema);

export type GymDetailsInput = z.infer<typeof gymDetailsSchema>;
export type OwnerAccountInput = z.infer<typeof ownerAccountSchema>;
export type PlanChoiceInput = z.infer<typeof planChoiceSchema>;
export type SignupNewUserInput = z.infer<typeof signupNewUserSchema>;
