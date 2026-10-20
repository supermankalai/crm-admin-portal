import type { z } from "zod";
import { memberContactSelfSchema, memberSchema } from "../validation/members";
import { assignPlanSchema, attendanceSchema, completeWorkoutSchema, createWorkoutPlanSchema, progressEntrySchema, progressPhotoSchema, trainerNoteSchema, trainingSessionSchema, trainingSessionUpdateSchema, workoutPlanSchema } from "../validation/fitness";
import { checkInLookupSchema, checkInSchema, recordPaymentSchema, sellMembershipSchema } from "../validation/payments";
import * as s from "./schemas";

/**
 * The mobile API contract: one entry per endpoint. The server uses it to validate requests and
 * shape responses, the OpenAPI document is generated from it, and the typed client is derived
 * from it — so the three can't drift apart.
 *
 * auth:
 *   none   — public (login, refresh, invite, OTP)
 *   user   — any valid access token, with or without a gym selected
 *   gym    — a gym-scoped token (staff or member)
 *   staff  — a gym-scoped token for active staff of that gym (permission checks on top)
 *   member — a gym-scoped token for a member app account in that gym
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AuthLevel = "none" | "user" | "gym" | "staff" | "member";

export type Endpoint = {
  method: HttpMethod;
  /** Relative to /api/mobile/v1; path params as {name}. */
  path: string;
  auth: AuthLevel;
  summary: string;
  tag: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  response: z.ZodType;
  /** Success status (default 200). */
  status?: number;
  /**
   * multipart/form-data upload: one file in `field`; the other form fields are validated with
   * `body`. The server checks the real file type from its bytes.
   */
  upload?: { field: string; maxBytes: number };
};

export const MOBILE_API_BASE = "/api/mobile/v1";

export const api = {
  // ── Auth ──
  login: { method: "POST", path: "/auth/login", auth: "none", tag: "Auth", summary: "Sign in with email or phone and password", body: s.loginRequestSchema, response: s.loginResponseSchema },
  otpRequest: { method: "POST", path: "/auth/otp/request", auth: "none", tag: "Auth", summary: "Send a one-time sign-in code (always 202, no account enumeration)", body: s.otpRequestSchema, response: s.otpRequestResponseSchema, status: 202 },
  otpVerify: { method: "POST", path: "/auth/otp/verify", auth: "none", tag: "Auth", summary: "Sign in with a one-time code", body: s.otpVerifySchema, response: s.loginResponseSchema },
  inviteLookup: { method: "POST", path: "/auth/invite/lookup", auth: "none", tag: "Auth", summary: "Check a member app invite link or front-desk code", body: s.inviteLookupRequestSchema, response: s.inviteLookupResponseSchema },
  inviteRedeem: { method: "POST", path: "/auth/invite/redeem", auth: "none", tag: "Auth", summary: "Accept a member app invite: create an account or link an existing one", body: s.inviteRedeemRequestSchema, response: s.loginResponseSchema },
  refresh: { method: "POST", path: "/auth/refresh", auth: "none", tag: "Auth", summary: "Rotate the refresh token (reuse of an old one revokes the device session)", body: s.refreshRequestSchema, response: s.refreshResponseSchema },
  selectGym: { method: "POST", path: "/auth/select-gym", auth: "user", tag: "Auth", summary: "Get an access token scoped to one of your gyms", body: s.selectGymRequestSchema, response: s.selectGymResponseSchema },
  logout: { method: "POST", path: "/auth/logout", auth: "user", tag: "Auth", summary: "End this device session", response: s.okSchema },

  // ── Me ──
  me: { method: "GET", path: "/me", auth: "user", tag: "Me", summary: "Your profile and gyms", response: s.meResponseSchema },
  devices: { method: "GET", path: "/me/devices", auth: "user", tag: "Me", summary: "Your signed-in devices", response: s.devicesResponseSchema },
  revokeDevice: { method: "DELETE", path: "/me/devices/{deviceId}", auth: "user", tag: "Me", summary: "Sign a device out", params: s.deviceIdParamsSchema, response: s.okSchema },
  changePassword: { method: "POST", path: "/me/password", auth: "user", tag: "Me", summary: "Change your password (signs out every device)", body: s.changePasswordRequestSchema, response: s.okSchema },

  notificationPreferences: { method: "GET", path: "/me/notification-preferences", auth: "gym", tag: "Me", summary: "Which push alerts you get from this gym (the in-app list keeps everything)", response: s.preferencesResponseSchema },
  updateNotificationPreferences: { method: "PUT", path: "/me/notification-preferences", auth: "gym", tag: "Me", summary: "Turn push alert categories on or off for this gym", body: s.updatePreferencesSchema, response: s.preferencesResponseSchema },
  registerPushToken: { method: "POST", path: "/me/push-token", auth: "gym", tag: "Me", summary: "Register this device's Expo push token for the selected gym", body: s.pushTokenRequestSchema, response: s.okSchema },
  removePushToken: { method: "DELETE", path: "/me/push-token", auth: "gym", tag: "Me", summary: "Stop push alerts from this gym on this device", response: s.okSchema },

  // ── Notifications & announcements ──
  notifications: { method: "GET", path: "/notifications", auth: "gym", tag: "Notifications", summary: "Your notifications in this gym, newest first", query: s.pageQuerySchema, response: s.notificationsResponseSchema },
  readNotification: { method: "POST", path: "/notifications/{notificationId}/read", auth: "gym", tag: "Notifications", summary: "Mark one of your notifications as read", params: s.notificationIdParamsSchema, response: s.okSchema },
  readAllNotifications: { method: "POST", path: "/notifications/read-all", auth: "gym", tag: "Notifications", summary: "Mark all your notifications in this gym as read", response: s.markedResponseSchema },
  announcements: { method: "GET", path: "/announcements", auth: "gym", tag: "Notifications", summary: "The gym's announcements for you (members see member and everyone announcements)", response: s.announcementsResponseSchema },

  // ── Gym ──
  gym: { method: "GET", path: "/gym", auth: "gym", tag: "Gym", summary: "The selected gym: branding, your role and permissions, subscription state", response: s.currentGymSchema },

  // ── Member app ──
  memberCard: { method: "GET", path: "/member/card", auth: "member", tag: "Member", summary: "Membership card with a rotating, single-use check-in QR code (45 s)", response: s.memberCardResponseSchema },
  memberMembership: { method: "GET", path: "/member/membership", auth: "member", tag: "Member", summary: "Current, upcoming and past memberships, freeze, credits and renewal reminder", response: s.memberMembershipResponseSchema },
  memberClasses: { method: "GET", path: "/member/classes", auth: "member", tag: "Member", summary: "Class timetable with spots left and your bookings (gym-local dates)", query: s.classesQuerySchema, response: s.memberClassesResponseSchema },
  memberBook: { method: "POST", path: "/member/classes/{sessionId}/book", auth: "member", tag: "Member", summary: "Book a class, or join its waitlist when full (never overbooks)", params: s.sessionIdParamsSchema, response: s.memberBookResponseSchema, status: 201 },
  memberCancelBooking: { method: "DELETE", path: "/member/bookings/{bookingId}", auth: "member", tag: "Member", summary: "Cancel your booking or leave a waitlist (within the gym's rules)", params: s.bookingIdParamsSchema, response: s.memberCancelResponseSchema },
  memberAttendance: { method: "GET", path: "/member/attendance", auth: "member", tag: "Member", summary: "Your check-in history", query: s.pageQuerySchema, response: s.attendancePageSchema },
  memberPayments: { method: "GET", path: "/member/payments", auth: "member", tag: "Member", summary: "Your payments", query: s.pageQuerySchema, response: s.paymentsPageSchema },
  memberInvoices: { method: "GET", path: "/member/invoices", auth: "member", tag: "Member", summary: "Your invoices", query: s.pageQuerySchema, response: s.invoicesPageSchema },
  memberInvoice: { method: "GET", path: "/member/invoices/{invoiceId}", auth: "member", tag: "Member", summary: "One of your invoices", params: s.invoiceIdParamsSchema, response: s.invoiceDetailSchema },
  memberWorkouts: { method: "GET", path: "/member/workouts", auth: "member", tag: "Member", summary: "Your active workout plans, with when you last did each day", response: s.memberWorkoutsResponseSchema },
  memberCompleteWorkout: { method: "POST", path: "/member/workouts/{dayId}/complete", auth: "member", tag: "Member", summary: "Mark a workout day as done (optional private note)", params: s.dayIdParamsSchema, body: completeWorkoutSchema, response: s.completeWorkoutResponseSchema, status: 201 },
  memberProgress: { method: "GET", path: "/member/progress", auth: "member", tag: "Member", summary: "Your measurements and progress photos (signed, 5-minute photo links)", response: s.memberProgressResponseSchema },
  memberSaveProgress: { method: "POST", path: "/member/progress", auth: "member", tag: "Member", summary: "Log weight and measurements for a day (replaces that day's entry)", body: progressEntrySchema, response: s.progressSavedResponseSchema, status: 201 },
  memberDeleteProgress: { method: "DELETE", path: "/member/progress/{entryId}", auth: "member", tag: "Member", summary: "Delete one of your measurement entries", params: s.entryIdParamsSchema, response: s.okSchema },
  memberUploadPhoto: { method: "POST", path: "/member/progress/photos", auth: "member", tag: "Member", summary: "Upload a progress photo (JPEG, PNG or WebP; location and other metadata are removed)", body: progressPhotoSchema, upload: { field: "photo", maxBytes: 8 * 1024 * 1024 }, response: s.photoUploadedResponseSchema, status: 201 },
  memberDeletePhoto: { method: "DELETE", path: "/member/progress/photos/{photoId}", auth: "member", tag: "Member", summary: "Delete one of your progress photos", params: s.photoIdParamsSchema, response: s.okSchema },
  memberProfile: { method: "GET", path: "/member/profile", auth: "member", tag: "Member", summary: "Your contact details, emergency contact and any account deletion request", response: s.memberProfileResponseSchema },
  memberUpdateProfile: { method: "PATCH", path: "/member/profile", auth: "member", tag: "Member", summary: "Update your contact details and emergency contact (same rules as the web)", body: memberContactSelfSchema, response: s.memberProfileResponseSchema },
  memberRequestDeletion: { method: "POST", path: "/member/deletion-request", auth: "member", tag: "Member", summary: "Ask the gym to delete your app account and personal data", body: s.deletionRequestSchema, response: s.deletionRequestResponseSchema, status: 201 },
  memberTrainingSessions: { method: "GET", path: "/member/training-sessions", auth: "member", tag: "Member", summary: "Your upcoming personal training sessions", response: s.memberTrainingSessionsResponseSchema },

  // ── Staff ── (request bodies are the same Zod schemas the web forms use)
  staffCheckInSetup: { method: "GET", path: "/staff/check-in", auth: "staff", tag: "Staff", summary: "Check-in locations and today's counts", response: s.checkInSetupResponseSchema },
  staffCheckInLookup: { method: "POST", path: "/staff/check-in/lookup", auth: "staff", tag: "Staff", summary: "Find a member by scanned QR (app or printed), member number or name", body: checkInLookupSchema, response: s.checkInLookupResponseSchema },
  staffCheckIn: { method: "POST", path: "/staff/check-in", auth: "staff", tag: "Staff", summary: "Check a member in (allowed or denied with the reason; every attempt is recorded)", body: checkInSchema, response: s.checkInResponseSchema, status: 201 },
  staffDashboard: { method: "GET", path: "/staff/dashboard", auth: "staff", tag: "Staff", summary: "Today's figures (money only for roles that may see it)", response: s.staffDashboardResponseSchema },
  staffAlerts: { method: "GET", path: "/staff/alerts", auth: "staff", tag: "Staff", summary: "Expiring memberships, overdue payments and full classes", response: s.staffAlertsResponseSchema },
  staffMembers: { method: "GET", path: "/staff/members", auth: "staff", tag: "Staff", summary: "Search and filter members", query: s.staffMembersQuerySchema, response: s.staffMembersResponseSchema },
  staffMember: { method: "GET", path: "/staff/members/{memberId}", auth: "staff", tag: "Staff", summary: "A member's profile, status, payments and attendance", params: s.memberIdParamsSchema, response: s.staffMemberProfileSchema },
  staffCreateMember: { method: "POST", path: "/staff/members", auth: "staff", tag: "Staff", summary: "Quick member sign-up (same rules as the web)", body: memberSchema, response: s.createMemberResponseSchema, status: 201 },
  staffPlans: { method: "GET", path: "/staff/plans", auth: "staff", tag: "Staff", summary: "Active membership plans for selling", response: s.staffPlansResponseSchema },
  staffSellMembership: { method: "POST", path: "/staff/memberships/sell", auth: "staff", tag: "Staff", summary: "Sell or renew a membership with an optional payment", body: sellMembershipSchema, response: s.sellResponseSchema, status: 201 },
  staffRecordPayment: { method: "POST", path: "/staff/payments", auth: "staff", tag: "Staff", summary: "Record a payment against an open invoice", body: recordPaymentSchema, response: s.recordPaymentResponseSchema, status: 201 },
  staffClasses: { method: "GET", path: "/staff/classes", auth: "staff", tag: "Staff", summary: "Classes with booking numbers (trainers: their own)", query: s.classesQuerySchema, response: s.staffClassesResponseSchema },
  staffClass: { method: "GET", path: "/staff/classes/{sessionId}", auth: "staff", tag: "Staff", summary: "One class with its bookings and waitlist", params: s.sessionIdParamsSchema, response: s.staffClassDetailSchema },
  // ── Trainer ── (own clients and classes; managers and owners: everyone in the gym)
  trainerSchedule: { method: "GET", path: "/trainer/schedule", auth: "staff", tag: "Trainer", summary: "Your classes, personal training sessions and shifts", query: s.classesQuerySchema, response: s.trainerScheduleResponseSchema },
  trainerAttendance: { method: "POST", path: "/trainer/bookings/{bookingId}/attendance", auth: "staff", tag: "Trainer", summary: "Mark a booking attended or no-show (from 30 minutes before the class until a day after)", params: s.bookingIdParamsSchema, body: attendanceSchema, response: s.attendanceResponseSchema },
  trainerClients: { method: "GET", path: "/trainer/clients", auth: "staff", tag: "Trainer", summary: "Your assigned clients", response: s.trainerClientsResponseSchema },
  trainerClient: { method: "GET", path: "/trainer/clients/{memberId}", auth: "staff", tag: "Trainer", summary: "A client: attendance, plans, workouts done, progress, photos (assigned trainers only) and notes", params: s.memberIdParamsSchema, response: s.trainerClientDetailSchema },
  trainerAddNote: { method: "POST", path: "/trainer/clients/{memberId}/notes", auth: "staff", tag: "Trainer", summary: "Add a private note about a client (you and managers can read it)", params: s.memberIdParamsSchema, body: trainerNoteSchema, response: s.trainerNoteItemSchema, status: 201 },
  trainerPlans: { method: "GET", path: "/trainer/workout-plans", auth: "staff", tag: "Trainer", summary: "Workout plans you wrote, and your clients' plans", response: s.workoutPlansResponseSchema },
  trainerPlan: { method: "GET", path: "/trainer/workout-plans/{planId}", auth: "staff", tag: "Trainer", summary: "A workout plan with its days and exercises", params: s.planIdParamsSchema, response: s.workoutPlanDetailSchema },
  trainerCreatePlan: { method: "POST", path: "/trainer/workout-plans", auth: "staff", tag: "Trainer", summary: "Create a plan for a client, or a template (no client)", body: createWorkoutPlanSchema, response: s.planSavedResponseSchema, status: 201 },
  trainerUpdatePlan: { method: "PUT", path: "/trainer/workout-plans/{planId}", auth: "staff", tag: "Trainer", summary: "Replace a plan's title, notes, status, days and exercises", params: s.planIdParamsSchema, body: workoutPlanSchema, response: s.planSavedResponseSchema },
  trainerAssignPlan: { method: "POST", path: "/trainer/workout-plans/{planId}/assign", auth: "staff", tag: "Trainer", summary: "Copy a plan to a client as their active plan", params: s.planIdParamsSchema, body: assignPlanSchema, response: s.planSavedResponseSchema, status: 201 },
  trainerCreateSession: { method: "POST", path: "/trainer/training-sessions", auth: "staff", tag: "Trainer", summary: "Book a personal training session with a client (no double-booking)", body: trainingSessionSchema, response: s.trainingSessionCreatedResponseSchema, status: 201 },
  trainerUpdateSession: { method: "PATCH", path: "/trainer/training-sessions/{trainingSessionId}", auth: "staff", tag: "Trainer", summary: "Mark a personal training session completed, cancelled or no-show", params: s.trainingSessionIdParamsSchema, body: trainingSessionUpdateSchema, response: s.okSchema },
  createMemberInvite: { method: "POST", path: "/staff/members/{memberId}/app-invite", auth: "staff", tag: "Staff", summary: "Invite a member to the app by email, SMS or a front-desk code", params: s.memberIdParamsSchema, body: s.createMemberInviteRequestSchema, response: s.createMemberInviteResponseSchema, status: 201 },
} as const satisfies Record<string, Endpoint>;

export type Api = typeof api;
export type EndpointName = keyof Api;

type Field<E, K extends string> = E extends Record<K, infer T> ? (T extends z.ZodType ? T : never) : never;

/** What a caller passes for an endpoint (params/query/body as needed). */
/** A file to upload: a Blob (web, tests) or React Native's { uri, name, type }. */
export type UploadFile = Blob | { uri: string; name: string; type: string };

export type RequestOf<N extends EndpointName> = (Field<Api[N], "params"> extends never ? object : { params: z.input<Field<Api[N], "params">> }) &
  (Field<Api[N], "query"> extends never ? object : { query?: z.input<Field<Api[N], "query">> }) &
  (Field<Api[N], "body"> extends never ? object : { body: z.input<Field<Api[N], "body">> }) &
  (Api[N] extends { upload: object } ? { file: UploadFile } : object);

export type ResponseOf<N extends EndpointName> = z.output<Api[N]["response"]>;
