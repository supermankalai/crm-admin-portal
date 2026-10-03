"use server";

import { revalidatePath } from "next/cache";
import { attendanceSchema, bookingIdSchema, bookSchema, cancelSessionSchema, classTypeSchema, roomSchema, sessionSchema, sessionUpdateSchema } from "@/lib/validation/classes";
import { gymAction } from "@/server/actions/gym-action";
import { getRequestMeta } from "@/server/security/request-meta";
import { bookMember, cancelBooking, markAttendance } from "@/server/services/classes/bookings";
import { cancelSession, createSessions, updateSession } from "@/server/services/classes/sessions";
import { saveClassType, saveRoom } from "@/server/services/classes/setup";
import { z } from "zod";

const refresh = (slug: string, sessionId?: string) => {
  revalidatePath(`/g/${slug}/classes`);
  revalidatePath(`/g/${slug}/schedule`);
  if (sessionId) revalidatePath(`/g/${slug}/classes/${sessionId}`);
};

export const saveClassTypeAction = gymAction({ permission: "classes.manage", schema: classTypeSchema, write: true }, async (ctx, input) => {
  const r = await saveClassType(ctx, input, await getRequestMeta());
  revalidatePath(`/g/${ctx.gym.slug}/classes/setup`);
  return r!;
});

export const saveRoomAction = gymAction({ permission: "classes.manage", schema: roomSchema, write: true }, async (ctx, input) => {
  const r = await saveRoom(ctx, input, await getRequestMeta());
  revalidatePath(`/g/${ctx.gym.slug}/classes/setup`);
  return r!;
});

export const createSessionsAction = gymAction({ permission: "classes.manage", schema: sessionSchema, write: true }, async (ctx, input) => {
  const r = await createSessions(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug);
  return r;
});

export const updateSessionAction = gymAction({ permission: "classes.view", schema: sessionUpdateSchema, write: true }, async (ctx, input) => {
  const r = await updateSession(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug, input.sessionId);
  return r;
});

export const cancelSessionAction = gymAction({ permission: "classes.view", schema: cancelSessionSchema, write: true }, async (ctx, input) => {
  const r = await cancelSession(ctx, input.sessionId, input.reason, await getRequestMeta());
  refresh(ctx.gym.slug, input.sessionId);
  return r;
});

export const bookMemberAction = gymAction({ permission: "classes.view", schema: bookSchema, write: true }, async (ctx, input) => {
  const r = await bookMember(ctx, input, await getRequestMeta());
  refresh(ctx.gym.slug, input.sessionId);
  return r;
});

export const cancelBookingAction = gymAction({ permission: "classes.view", schema: bookingIdSchema.extend({ sessionId: z.string().min(1).max(64) }), write: true }, async (ctx, input) => {
  const r = await cancelBooking(ctx, input.bookingId, await getRequestMeta());
  refresh(ctx.gym.slug, input.sessionId);
  return r;
});

export const markAttendanceAction = gymAction({ permission: "classes.view", schema: attendanceSchema.extend({ sessionId: z.string().min(1).max(64) }), write: true }, async (ctx, input) => {
  const r = await markAttendance(ctx, input.bookingId, input.attended, await getRequestMeta());
  refresh(ctx.gym.slug, input.sessionId);
  return r;
});
