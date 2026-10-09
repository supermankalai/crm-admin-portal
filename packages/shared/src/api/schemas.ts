import { z } from "zod";
import { changePasswordSchema } from "../validation/auth";

/**
 * Request and response shapes of the mobile API (/api/mobile/v1). Shared by the server (which
 * validates requests and filters responses through them) and the mobile app (which validates
 * responses). Responses are z.object()s, so unknown fields are stripped before anything leaves
 * the server.
 */

const isoDateTime = z.string().datetime({ offset: true });

// ─────────────────────────────── Errors ───────────────────────────────

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const okSchema = z.object({ ok: z.literal(true) });

// ─────────────────────────────── Auth ───────────────────────────────

export const devicePlatformSchema = z.enum(["ios", "android", "web"]);

export const deviceInfoSchema = z.object({
  name: z.string().trim().min(1).max(100),
  platform: devicePlatformSchema,
  appVersion: z.string().trim().max(40).optional(),
});

/** An email address or a phone number; the server works out which. */
export const identifierSchema = z.string().trim().min(3, "Enter your email or phone number").max(254);

export const loginRequestSchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(1, "Enter your password").max(128),
  device: deviceInfoSchema,
});

export const otpRequestSchema = z.object({ identifier: identifierSchema });

export const otpVerifySchema = z.object({
  identifier: identifierSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
  device: deviceInfoSchema,
});

/** An emailed/SMS link token (43 chars) or a front-desk code (8 chars, any case, dashes ignored). */
export const inviteTokenSchema = z.string().trim().min(8).max(100);

export const inviteLookupRequestSchema = z.object({ token: inviteTokenSchema });

export const inviteRedeemRequestSchema = z.object({
  token: inviteTokenSchema,
  /** For a new account: the name to use. Ignored when linking an existing account. */
  name: z.string().trim().min(2).max(80).optional(),
  /** New account: the password to set. Existing account: its current password. */
  password: z.string().min(1).max(128),
  device: deviceInfoSchema,
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(20).max(200),
  /** Re-scope the new access token to this gym (membership is checked again). */
  gymSlug: z.string().max(48).optional(),
});

export const selectGymRequestSchema = z.object({ gymSlug: z.string().min(3).max(48) });

export const changePasswordRequestSchema = changePasswordSchema;

export const gymRoleSchema = z.enum(["OWNER", "MANAGER", "FRONT_DESK", "TRAINER", "MEMBER"]);
export type GymRole = z.infer<typeof gymRoleSchema>;

/** Logo as a short-lived signed path ("/api/mobile/v1/files/…"); prefix it with the API host. */
const logoUrlSchema = z.string().nullable();

export const gymSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  brandColor: z.string(),
  logoUrl: logoUrlSchema,
  role: gymRoleSchema,
  /** Whether the gym's plan allows this kind of user in the app. */
  appAccess: z.object({ allowed: z.boolean(), reason: z.enum(["feature_not_in_plan"]).nullable() }),
});

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTime,
  refreshToken: z.string(),
  refreshTokenExpiresAt: isoDateTime,
  sessionId: z.string(),
});

export const loginResponseSchema = tokenPairSchema.extend({
  user: z.object({ id: z.string(), name: z.string() }),
  gyms: z.array(gymSummarySchema),
});

export const accessStateSchema = z.object({
  writable: z.boolean(),
  reason: z.string().nullable(),
  isTrial: z.boolean(),
  endsAt: isoDateTime.nullable(),
});

export const currentGymSchema = z.object({
  slug: z.string(),
  name: z.string(),
  brandColor: z.string(),
  logoUrl: logoUrlSchema,
  timezone: z.string(),
  currency: z.string(),
  role: gymRoleSchema,
  /** Staff permissions (empty for members). The server re-checks every one. */
  permissions: z.array(z.string()),
  access: accessStateSchema,
});

export const selectGymResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTime,
  gym: currentGymSchema,
});

export const refreshResponseSchema = tokenPairSchema.extend({
  gym: currentGymSchema.nullable(),
  /**
   * Set when gymSlug was given but that gym can't be used any more (removed, plan changed).
   * The refresh itself still succeeded — keep the new refresh token and show the gym picker.
   */
  gymError: z.object({ code: z.string(), message: z.string() }).nullable(),
});

export const otpRequestResponseSchema = z.object({ sent: z.literal(true) });

export const inviteLookupResponseSchema = z.object({
  state: z.enum(["valid", "expired", "used", "revoked"]),
  gym: z.object({ name: z.string(), brandColor: z.string() }),
  firstName: z.string(),
  /** An account already exists for the invited email/phone: sign in with its password to link it. */
  hasAccount: z.boolean(),
  /** Masked destination, e.g. "a•••@example.com" or "•••• 4321". */
  destination: z.string(),
});

// ─────────────────────────────── Me ───────────────────────────────

export const meResponseSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable() }),
  gyms: z.array(gymSummarySchema),
});

export const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: z.string(),
  appVersion: z.string().nullable(),
  createdAt: isoDateTime,
  lastSeenAt: isoDateTime,
  current: z.boolean(),
});
export const devicesResponseSchema = z.object({ devices: z.array(deviceSchema) });
export const deviceIdParamsSchema = z.object({ deviceId: z.string().min(1).max(64) });

// ─────────────────────────────── Staff ───────────────────────────────

export const memberIdParamsSchema = z.object({ memberId: z.string().min(1).max(64) });

export const createMemberInviteRequestSchema = z.object({ channel: z.enum(["EMAIL", "SMS", "CODE"]) });

export const createMemberInviteResponseSchema = z.object({
  inviteId: z.string(),
  channel: z.enum(["EMAIL", "SMS", "CODE"]),
  expiresAt: isoDateTime,
  /** Front-desk code to read out or show — returned only for CODE invites, only this once. */
  code: z.string().nullable(),
  /** Masked email/phone the link was sent to (EMAIL/SMS). */
  sentTo: z.string().nullable(),
});

// ─────────────────────────────── Pagination ───────────────────────────────

/** Cursor pagination for every list endpoint. */
export const pageQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

// ─────────────────────────────── Member app ───────────────────────────────

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const membershipViewSchema = z.object({
  id: z.string(),
  planName: z.string(),
  planType: z.enum(["MONTHLY", "QUARTERLY", "YEARLY", "CLASS_PACK"]),
  state: z.enum(["upcoming", "active", "frozen", "expired", "cancelled"]),
  startDate: dateOnly,
  endDate: dateOnly,
  daysRemaining: z.number().int(),
  classCreditsRemaining: z.number().int().nullable(),
  frozen: z.object({ from: dateOnly, to: dateOnly }).nullable(),
  cancelledAt: isoDateTime.nullable(),
});

export const memberSummarySchema = z.object({ name: z.string(), memberNumber: z.string() });

export const memberCardResponseSchema = z.object({
  member: memberSummarySchema,
  membership: membershipViewSchema.nullable(),
  /** Rotating check-in code: show it as a QR; fetch a new one every refreshInSeconds. */
  qr: z.object({ token: z.string(), expiresAt: isoDateTime, refreshInSeconds: z.number().int() }),
});

export const memberMembershipResponseSchema = z.object({
  member: memberSummarySchema,
  current: membershipViewSchema.nullable(),
  upcoming: z.array(membershipViewSchema),
  past: z.array(membershipViewSchema),
  renewal: z.object({ daysLeft: z.number().int(), message: z.string() }).nullable(),
  rules: z.object({ bookingDaysAhead: z.number().int(), cancelHoursBefore: z.number().int() }),
});

export const classesQuerySchema = z.object({ from: dateOnly.optional(), to: dateOnly.optional() });

export const memberClassSchema = z.object({
  id: z.string(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  status: z.enum(["SCHEDULED", "CANCELLED", "COMPLETED"]),
  className: z.string(),
  classColor: z.string(),
  description: z.string().nullable(),
  room: z.string(),
  location: z.string(),
  trainer: z.string(),
  capacity: z.number().int(),
  booked: z.number().int(),
  waitlisted: z.number().int(),
  spotsLeft: z.number().int(),
  my: z.object({ bookingId: z.string(), status: z.enum(["BOOKED", "WAITLISTED", "ATTENDED", "NO_SHOW"]), waitlistPosition: z.number().int().nullable() }).nullable(),
  canBook: z.boolean(),
  canCancel: z.boolean(),
  /** After this moment a booked spot can't be cancelled in the app. */
  cancelDeadline: isoDateTime,
});

export const memberClassesResponseSchema = z.object({
  from: dateOnly,
  to: dateOnly,
  classes: z.array(memberClassSchema),
  rules: z.object({ bookingDaysAhead: z.number().int(), cancelHoursBefore: z.number().int() }),
});

export const sessionIdParamsSchema = z.object({ sessionId: z.string().min(1).max(64) });
export const bookingIdParamsSchema = z.object({ bookingId: z.string().min(1).max(64) });
export const invoiceIdParamsSchema = z.object({ invoiceId: z.string().min(1).max(64) });

export const memberBookResponseSchema = z.object({ bookingId: z.string(), status: z.enum(["BOOKED", "WAITLISTED"]), waitlistPosition: z.number().int().nullable() });
export const memberCancelResponseSchema = z.object({ ok: z.literal(true), creditReturned: z.boolean() });

export const attendanceItemSchema = z.object({
  id: z.string(),
  checkedInAt: isoDateTime,
  location: z.string(),
  allowed: z.boolean(),
  reason: z.string().nullable(),
});

export const paymentItemSchema = z.object({
  id: z.string(),
  receivedAt: isoDateTime,
  amountMinor: z.number().int(),
  refundedMinor: z.number().int(),
  currency: z.string(),
  method: z.enum(["CASH", "CARD", "TRANSFER"]),
  status: z.enum(["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED", "VOID"]),
  invoice: z.object({ id: z.string(), number: z.string() }).nullable(),
});

export const invoiceItemSchema = z.object({
  id: z.string(),
  number: z.string(),
  description: z.string().nullable(),
  issuedAt: isoDateTime,
  dueDate: dateOnly,
  currency: z.string(),
  totalMinor: z.number().int(),
  amountPaidMinor: z.number().int(),
  status: z.enum(["OPEN", "PAID", "VOID", "OVERDUE"]),
});

export const invoiceDetailSchema = invoiceItemSchema.extend({
  subtotalMinor: z.number().int(),
  taxMinor: z.number().int(),
  gym: z.object({ name: z.string(), address: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable() }),
  payments: z.array(paymentItemSchema.omit({ invoice: true })),
});

export const attendancePageSchema = pageOf(attendanceItemSchema);
export const paymentsPageSchema = pageOf(paymentItemSchema);
export const invoicesPageSchema = pageOf(invoiceItemSchema);

// ─────────────────────────────── Staff app ───────────────────────────────

export const checkInResultSchema = z.enum(["ALLOWED", "DENIED_EXPIRED", "DENIED_FROZEN", "DENIED_NO_MEMBERSHIP"]);

export const checkInCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberNumber: z.string(),
  decision: z.object({ result: checkInResultSchema, message: z.string() }),
  overdueInvoices: z.number().int(),
});

export const checkInLookupResponseSchema = z.object({
  method: z.enum(["NAME_SEARCH", "MEMBER_ID", "QR"]),
  candidates: z.array(checkInCandidateSchema),
});

export const checkInResponseSchema = z.object({
  memberId: z.string(),
  name: z.string(),
  result: checkInResultSchema,
  message: z.string(),
  duplicate: z.boolean(),
  overdueInvoices: z.number().int(),
  checkedInAt: isoDateTime,
});

export const checkInSetupResponseSchema = z.object({
  locations: z.array(z.object({ id: z.string(), name: z.string() })),
  today: z.object({ allowed: z.number().int(), denied: z.number().int() }),
});

export const staffDashboardResponseSchema = z.object({
  today: dateOnly,
  checkInsToday: z.number().int(),
  activeMembers: z.number().int(),
  newThisMonth: z.number().int(),
  currency: z.string(),
  /** Null when your role can't see money (front desk, trainers). */
  revenue: z.object({ todayMinor: z.number().int(), monthMinor: z.number().int() }).nullable(),
  expiring: z.array(z.object({ memberId: z.string(), name: z.string(), plan: z.string(), endDate: dateOnly })),
  overdue: z.object({ count: z.number().int(), totalMinor: z.number().int() }).nullable(),
  todaysClasses: z.array(
    z.object({
      id: z.string(),
      startsAt: isoDateTime,
      className: z.string(),
      classColor: z.string(),
      trainer: z.string(),
      room: z.string(),
      capacity: z.number().int(),
      booked: z.number().int(),
      waitlisted: z.number().int(),
      status: z.string(),
    })
  ),
});

export const memberStatusSchema = z.enum(["active", "frozen", "expired", "none"]);

export const staffMembersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: memberStatusSchema.optional(),
  cursor: z.string().regex(/^\d{1,5}$/).optional(),
});

export const staffMemberRowSchema = z.object({
  id: z.string(),
  memberNumber: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  status: memberStatusSchema,
  planName: z.string().nullable(),
  endDate: dateOnly.nullable(),
  lastVisit: isoDateTime.nullable(),
});

export const staffMembersResponseSchema = z.object({ items: z.array(staffMemberRowSchema), nextCursor: z.string().nullable(), total: z.number().int() });

export const staffMemberProfileSchema = z.object({
  member: z.object({
    id: z.string(),
    memberNumber: z.string(),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    emergencyContact: z.object({ name: z.string(), phone: z.string().nullable(), relation: z.string().nullable() }).nullable(),
    joinedAt: isoDateTime,
  }),
  status: memberStatusSchema,
  memberships: z.array(z.object({ id: z.string(), planName: z.string(), state: z.string(), startDate: dateOnly, endDate: dateOnly, classCreditsRemaining: z.number().int().nullable() })),
  visits: z.object({ last30Days: z.number().int(), total: z.number().int() }),
  recentCheckIns: z.array(z.object({ id: z.string(), checkedInAt: isoDateTime, allowed: z.boolean(), location: z.string() })),
  payments: z
    .array(z.object({ id: z.string(), receivedAt: isoDateTime, amountMinor: z.number().int(), refundedMinor: z.number().int(), method: z.string(), invoiceNumber: z.string().nullable() }))
    .nullable(),
  openInvoices: z
    .array(z.object({ id: z.string(), number: z.string(), description: z.string().nullable(), dueDate: dateOnly, totalMinor: z.number().int(), amountPaidMinor: z.number().int(), overdue: z.boolean() }))
    .nullable(),
  appAccount: z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }).nullable(),
  currency: z.string(),
  can: z.object({ recordPayment: z.boolean(), sellMembership: z.boolean(), inviteToApp: z.boolean() }),
});

export const createMemberResponseSchema = z.object({ memberId: z.string(), memberNumber: z.string() });
export const recordPaymentResponseSchema = z.object({ paymentId: z.string(), invoiceStatus: z.enum(["OPEN", "PAID", "VOID"]), amountPaidMinor: z.number().int() });

export const staffPlansResponseSchema = z.object({
  currency: z.string(),
  taxRateBps: z.number().int(),
  plans: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), priceMinor: z.number().int(), durationDays: z.number().int(), classCredits: z.number().int().nullable() })),
});

export const sellResponseSchema = z.object({
  membershipId: z.string(),
  invoiceId: z.string(),
  invoiceNumber: z.string(),
  totalMinor: z.number().int(),
  paidMinor: z.number().int(),
  startDate: dateOnly,
  endDate: dateOnly,
});

export const staffAlertsResponseSchema = z.object({
  expiring: z.array(z.object({ memberId: z.string(), name: z.string(), plan: z.string(), endDate: dateOnly })),
  overdue: z
    .array(z.object({ invoiceId: z.string(), number: z.string(), memberId: z.string(), memberName: z.string(), dueDate: dateOnly, outstandingMinor: z.number().int() }))
    .nullable(),
  fullClasses: z.array(z.object({ sessionId: z.string(), className: z.string(), startsAt: isoDateTime, capacity: z.number().int(), waitlisted: z.number().int() })),
  currency: z.string(),
});

export const staffClassSchema = z.object({
  id: z.string(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  status: z.enum(["SCHEDULED", "CANCELLED", "COMPLETED"]),
  className: z.string(),
  classColor: z.string(),
  trainer: z.string(),
  room: z.string(),
  location: z.string(),
  capacity: z.number().int(),
  booked: z.number().int(),
  waitlisted: z.number().int(),
});

export const staffClassesResponseSchema = z.object({ from: dateOnly, to: dateOnly, classes: z.array(staffClassSchema) });

export const staffClassDetailSchema = staffClassSchema.extend({
  /** You teach it (or manage classes) and attendance is open (30 min before until a day after). */
  canMarkAttendance: z.boolean(),
  bookings: z.array(
    z.object({
      bookingId: z.string(),
      memberId: z.string(),
      name: z.string(),
      memberNumber: z.string(),
      status: z.enum(["BOOKED", "WAITLISTED", "CANCELLED", "ATTENDED", "NO_SHOW"]),
      waitlistPosition: z.number().int().nullable(),
    })
  ),
});

// ─────────────────────────────── Trainer & fitness ───────────────────────────────

export const planIdParamsSchema = z.object({ planId: z.string().min(1).max(64) });
export const dayIdParamsSchema = z.object({ dayId: z.string().min(1).max(64) });
export const entryIdParamsSchema = z.object({ entryId: z.string().min(1).max(64) });
export const photoIdParamsSchema = z.object({ photoId: z.string().min(1).max(64) });
export const trainingSessionIdParamsSchema = z.object({ trainingSessionId: z.string().min(1).max(64) });

const measurementsSchema = z.object({
  weightKg: z.number().optional(),
  bodyFatPct: z.number().optional(),
  chestCm: z.number().optional(),
  waistCm: z.number().optional(),
  hipsCm: z.number().optional(),
  armCm: z.number().optional(),
  thighCm: z.number().optional(),
});

export const progressEntryItemSchema = z.object({ id: z.string(), recordedOn: dateOnly, values: measurementsSchema });
/** A photo with a short-lived signed path (prefix it with the API host). */
export const progressPhotoItemSchema = z.object({ id: z.string(), takenOn: dateOnly, url: z.string() });

export const exerciseItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  sets: z.number().int().nullable(),
  reps: z.string().nullable(),
  restSeconds: z.number().int().nullable(),
  notes: z.string().nullable(),
});

export const planDayItemSchema = z.object({ id: z.string(), title: z.string(), exercises: z.array(exerciseItemSchema) });

export const planStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);

export const workoutPlanDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string().nullable(),
  status: planStatusSchema,
  member: z.object({ id: z.string(), name: z.string() }).nullable(),
  trainer: z.string(),
  canEdit: z.boolean(),
  updatedAt: isoDateTime,
  days: z.array(planDayItemSchema),
});

export const workoutPlanRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: planStatusSchema,
  member: z.object({ id: z.string(), name: z.string() }).nullable(),
  dayCount: z.number().int(),
  updatedAt: isoDateTime,
});

export const workoutPlansResponseSchema = z.object({ plans: z.array(workoutPlanRowSchema) });
export const planSavedResponseSchema = z.object({ planId: z.string() });

export const trainingSessionItemSchema = z.object({
  id: z.string(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
  focus: z.string().nullable(),
  trainer: z.string(),
  member: z.object({ id: z.string(), name: z.string() }),
});

export const scheduleItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("class"), id: z.string(), startsAt: isoDateTime, endsAt: isoDateTime, title: z.string(), color: z.string(), room: z.string(), booked: z.number().int(), capacity: z.number().int(), status: z.string() }),
  z.object({ kind: z.literal("pt"), id: z.string(), startsAt: isoDateTime, endsAt: isoDateTime, member: z.object({ id: z.string(), name: z.string() }), focus: z.string().nullable(), status: z.string() }),
  z.object({ kind: z.literal("shift"), id: z.string(), startsAt: isoDateTime, endsAt: isoDateTime, location: z.string() }),
]);

export const trainerScheduleResponseSchema = z.object({ from: dateOnly, to: dateOnly, items: z.array(scheduleItemSchema) });

export const trainerClientRowSchema = z.object({
  memberId: z.string(),
  name: z.string(),
  memberNumber: z.string(),
  status: z.enum(["active", "frozen", "expired", "none"]),
  lastVisit: isoDateTime.nullable(),
  activePlan: z.string().nullable(),
  nextSession: isoDateTime.nullable(),
});

export const trainerClientsResponseSchema = z.object({ clients: z.array(trainerClientRowSchema) });

export const trainerNoteItemSchema = z.object({ id: z.string(), body: z.string(), author: z.string(), mine: z.boolean(), createdAt: isoDateTime });

export const trainerClientDetailSchema = z.object({
  member: z.object({ id: z.string(), name: z.string(), memberNumber: z.string(), phone: z.string().nullable(), joinedAt: isoDateTime }),
  status: z.enum(["active", "frozen", "expired", "none"]),
  membership: z.object({ planName: z.string(), endDate: dateOnly }).nullable(),
  visits: z.object({ last30Days: z.number().int(), total: z.number().int(), lastVisit: isoDateTime.nullable() }),
  plans: z.array(workoutPlanRowSchema),
  completions: z.array(z.object({ id: z.string(), completedAt: isoDateTime, plan: z.string(), day: z.string(), note: z.string().nullable() })),
  progress: z.array(progressEntryItemSchema),
  /** Null when you aren't one of the member's assigned trainers (photos are private to them). */
  photos: z.array(progressPhotoItemSchema).nullable(),
  notes: z.array(trainerNoteItemSchema),
  sessions: z.array(trainingSessionItemSchema),
  isMyClient: z.boolean(),
});

export const memberWorkoutsResponseSchema = z.object({
  plans: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      notes: z.string().nullable(),
      trainer: z.string(),
      days: z.array(planDayItemSchema.extend({ lastCompletedAt: isoDateTime.nullable(), timesCompleted: z.number().int() })),
    })
  ),
  recent: z.array(z.object({ id: z.string(), completedAt: isoDateTime, plan: z.string(), day: z.string() })),
  thisWeek: z.number().int(),
});

export const completeWorkoutResponseSchema = z.object({ completionId: z.string(), completedAt: isoDateTime });

export const memberProgressResponseSchema = z.object({ entries: z.array(progressEntryItemSchema), photos: z.array(progressPhotoItemSchema) });
export const progressSavedResponseSchema = z.object({ id: z.string(), recordedOn: dateOnly });
export const photoUploadedResponseSchema = progressPhotoItemSchema;

export const memberTrainingSessionsResponseSchema = z.object({ sessions: z.array(trainingSessionItemSchema) });
export const trainingSessionCreatedResponseSchema = z.object({ id: z.string() });
export const attendanceResponseSchema = z.object({ status: z.enum(["ATTENDED", "NO_SHOW"]) });
