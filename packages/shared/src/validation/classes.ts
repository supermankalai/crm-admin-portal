import { z } from "zod";
import { isDateString } from "../domain/dates";

const id = z.string().trim().min(1).max(64);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const classTypeSchema = z.object({
  classTypeId: id.optional(),
  name: z.string().trim().min(2, "Enter a name").max(60),
  description: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? null : v)),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  durationMinutes: z.coerce.number().int().min(10).max(240),
  defaultCapacity: z.coerce.number().int().min(1).max(500),
});

export const roomSchema = z.object({
  roomId: id.optional(),
  locationId: id,
  name: z.string().trim().min(1, "Enter a name").max(60),
  capacity: z.coerce.number().int().min(1).max(500),
});

export const deliveryModeSchema = z.enum(["IN_PERSON", "ONLINE", "HYBRID"]);
/** A room, or none ("" or null) for an online class. Whether one is needed is checked per mode. */
const optionalRoom = z
  .string()
  .trim()
  .max(64)
  .nullish()
  .transform((v) => v || null);

export const sessionSchema = z
  .object({
    classTypeId: id,
    trainerId: id,
    deliveryMode: deliveryModeSchema.default("IN_PERSON"),
    roomId: optionalRoom,
    date: z.string().refine(isDateString, "Choose a date"),
    startTime: time,
    durationMinutes: z.coerce.number().int().min(10).max(240),
    capacity: z.coerce.number().int().min(1).max(500),
    repeatWeeks: z.coerce.number().int().min(1, "At least 1").max(12, "At most 12 weeks"),
  })
  .superRefine((v, ctx) => {
    if (v.deliveryMode !== "ONLINE" && !v.roomId) ctx.addIssue({ code: "custom", path: ["roomId"], message: "Choose a room" });
  });

/** Trainer, room and capacity. How a class is delivered is set when it's scheduled. */
export const sessionUpdateSchema = z.object({
  sessionId: id,
  trainerId: id,
  roomId: optionalRoom,
  capacity: z.coerce.number().int().min(1).max(500),
});

export const sessionIdSchema = z.object({ sessionId: id });
export const cancelSessionSchema = z.object({ sessionId: id, reason: z.string().trim().min(3, "Give a reason").max(200) });
export const bookSchema = z.object({ sessionId: id, memberId: id });
export const bookingIdSchema = z.object({ bookingId: id });
export const attendanceSchema = z.object({ bookingId: id, attended: z.boolean() });

/** What the scheduling service takes: the form's values, with in person as the default. */
export type SessionInput = Omit<z.output<typeof sessionSchema>, "deliveryMode"> & { deliveryMode?: z.output<typeof deliveryModeSchema> };
