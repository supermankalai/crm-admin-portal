import { z } from "zod";
import { isDateString } from "@/domain/dates";
import { normalisePhone } from "@/domain/phone";
import { emailSchema, newPasswordSchema } from "./auth";

const id = z.string().trim().min(1).max(64);
const ROLES = ["OWNER", "MANAGER", "FRONT_DESK", "TRAINER"] as const;

export const inviteSchema = z.object({ email: emailSchema, role: z.enum(ROLES) });
export const revokeInviteSchema = z.object({ invitationId: id });

export const roleChangeSchema = z.object({ staffId: id, role: z.enum(ROLES) });
export const staffIdSchema = z.object({ staffId: id });

export const staffProfileSchema = z.object({
  staffId: id,
  title: z
    .string()
    .trim()
    .max(60)
    .transform((v) => (v === "" ? null : v)),
  bio: z
    .string()
    .trim()
    .max(600)
    .transform((v) => (v === "" ? null : v)),
  specialties: z
    .string()
    .trim()
    .max(200)
    .transform((v) => [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 10)),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === "" || normalisePhone(v) !== null, "Enter a valid phone number")
    .transform((v) => (v === "" ? null : v)),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === "" ? null : v)),
});

export const clientAssignmentSchema = z.object({ staffId: id, memberId: id });

export const shiftSchema = z
  .object({
    staffId: id,
    locationId: id,
    date: z.string().refine(isDateString, "Choose a date"),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  })
  .refine((s) => s.end > s.start, { path: ["end"], message: "Ends after it starts" });
export const shiftIdSchema = z.object({ shiftId: id });

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(100),
  name: z.string().trim().max(80).optional(),
  password: z.string().max(128).optional(),
});
export const newAccountForInviteSchema = z
  .object({ name: z.string().trim().min(2, "Enter your full name").max(80), password: newPasswordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });
