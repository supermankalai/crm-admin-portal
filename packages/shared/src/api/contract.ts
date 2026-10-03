import type { z } from "zod";
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

  // ── Staff ──
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
