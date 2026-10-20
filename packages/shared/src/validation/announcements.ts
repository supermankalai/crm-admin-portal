import { z } from "zod";

/** Announcements and account-deletion handling (web portal forms and server actions). */

export const ANNOUNCEMENT_AUDIENCES = ["EVERYONE", "MEMBERS", "STAFF"] as const;
export const AUDIENCE_LABELS: Record<(typeof ANNOUNCEMENT_AUDIENCES)[number], string> = {
  EVERYONE: "Members and staff",
  MEMBERS: "Members (app users)",
  STAFF: "Staff only",
};

export const announcementSchema = z.object({
  title: z.string().trim().min(1, "Add a title").max(120, "At most 120 characters"),
  body: z.string().trim().min(1, "Write the announcement").max(2000, "At most 2000 characters"),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES),
});
export type AnnouncementInput = z.output<typeof announcementSchema>;
export type AnnouncementFormValues = z.input<typeof announcementSchema>;

export const announcementIdSchema = z.object({ announcementId: z.string().min(1).max(64) });

export const resolveDeletionSchema = z.object({
  requestId: z.string().min(1).max(64),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v)),
});

export const memberAppAccessSchema = z.object({ memberId: z.string().min(1).max(64), enabled: z.boolean() });
export const memberAppInviteSchema = z.object({ memberId: z.string().min(1).max(64), channel: z.enum(["EMAIL", "SMS", "CODE"]) });
