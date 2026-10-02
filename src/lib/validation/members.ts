import { z } from "zod";
import { isDateString } from "@/domain/dates";
import { normalisePhone } from "@/domain/phone";

/** Optional free text: trims, and turns "" into null so "cleared" and "never set" are the same. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((v) => (v === "" ? null : v));

const optionalPhone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => v === "" || normalisePhone(v) !== null, "Enter a valid phone number")
  .transform((v) => (v === "" ? null : v));

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address")
  .transform((v) => (v === "" ? null : v));

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || isDateString(v), "Enter a valid date")
  .refine((v) => v === "" || (v >= "1900-01-01" && v <= new Date().toISOString().slice(0, 10)), "Date of birth must be in the past")
  .transform((v) => (v === "" ? null : v));

const emergencyContact = z
  .object({
    name: optionalText(80),
    phone: optionalPhone,
    relation: optionalText(40),
  })
  .refine((c) => (c.name === null) === (c.phone === null), { message: "Give both a name and a phone number for the emergency contact", path: ["name"] });

/** Fields any member-editing role may change (front desk: these only). */
export const memberContactFields = {
  email: optionalEmail,
  phone: optionalPhone,
  address: optionalText(300),
  emergencyContact,
};

export const memberSchema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name").max(60),
  lastName: z.string().trim().min(1, "Enter a last name").max(60),
  dateOfBirth: optionalDate,
  healthNotes: optionalText(2000),
  ...memberContactFields,
});
export type MemberInput = z.infer<typeof memberSchema>;
export type MemberFormValues = z.input<typeof memberSchema>;

export const memberUpdateSchema = memberSchema.extend({ memberId: z.string().min(1).max(64) });
export const memberContactUpdateSchema = z.object({ memberId: z.string().min(1).max(64), ...memberContactFields });

export const memberIdSchema = z.object({ memberId: z.string().min(1).max(64) });

export const memberNoteSchema = z.object({
  memberId: z.string().min(1).max(64),
  body: z.string().trim().min(1, "Write a note").max(2000),
});

export const freezeSchema = z.object({
  membershipId: z.string().min(1).max(64),
  days: z.coerce.number().int("Whole days only").min(1, "At least 1 day").max(365),
});
export const membershipIdSchema = z.object({ membershipId: z.string().min(1).max(64) });
export const cancelMembershipSchema = z.object({
  membershipId: z.string().min(1).max(64),
  reason: z.string().trim().min(3, "Give a reason").max(300),
});

export const MEMBER_STATUS_FILTERS = ["active", "frozen", "expired", "none"] as const;
export type MemberStatusFilter = (typeof MEMBER_STATUS_FILTERS)[number];
