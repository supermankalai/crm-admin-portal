import type { z } from "zod";
import { memberSchema } from "../validation/members";
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
  createMemberInvite: { method: "POST", path: "/staff/members/{memberId}/app-invite", auth: "staff", tag: "Staff", summary: "Invite a member to the app by email, SMS or a front-desk code", params: s.memberIdParamsSchema, body: s.createMemberInviteRequestSchema, response: s.createMemberInviteResponseSchema, status: 201 },
} as const satisfies Record<string, Endpoint>;

export type Api = typeof api;
export type EndpointName = keyof Api;

type Field<E, K extends string> = E extends Record<K, infer T> ? (T extends z.ZodType ? T : never) : never;

/** What a caller passes for an endpoint (params/query/body as needed). */
export type RequestOf<N extends EndpointName> = (Field<Api[N], "params"> extends never ? object : { params: z.input<Field<Api[N], "params">> }) &
  (Field<Api[N], "query"> extends never ? object : { query?: z.input<Field<Api[N], "query">> }) &
  (Field<Api[N], "body"> extends never ? object : { body: z.input<Field<Api[N], "body">> });

export type ResponseOf<N extends EndpointName> = z.output<Api[N]["response"]>;
