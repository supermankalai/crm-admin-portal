import { randomInt } from "node:crypto";
import { NextRequest } from "next/server";

/** Call a mobile API route handler directly, the way Next.js would, and decode the JSON reply. */

type Handler = (req: NextRequest, segment?: { params?: Promise<Record<string, string | string[]>> }) => Promise<Response>;

export type ApiReply<T = Record<string, unknown>> = { status: number; body: T & { error?: { code: string; message: string; fieldErrors?: Record<string, string[]> } }; headers: Headers };

/** A fresh client IP per call (unless given), so per-IP rate limits don't leak between tests. */
export const randomIp = () => `198.51.${randomInt(0, 255)}.${randomInt(1, 254)}`;

export async function callApi<T = Record<string, unknown>>(
  handler: Handler,
  opts: { method?: string; body?: unknown; token?: string; params?: Record<string, string>; ip?: string; query?: Record<string, string>; rawBody?: string; contentType?: string } = {}
): Promise<ApiReply<T>> {
  const headers = new Headers({ "x-forwarded-for": opts.ip ?? randomIp(), "user-agent": "vitest" });
  if (opts.body !== undefined || opts.rawBody !== undefined) headers.set("content-type", opts.contentType ?? "application/json");
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
  const req = new NextRequest(`http://localhost/api/mobile/v1/test${qs}`, {
    method: opts.method ?? (opts.body !== undefined || opts.rawBody !== undefined ? "POST" : "GET"),
    headers,
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, body: (await res.json()) as ApiReply<T>["body"], headers: res.headers };
}

export const device = (name = "Test phone") => ({ name, platform: "android" as const, appVersion: "1.0.0" });
