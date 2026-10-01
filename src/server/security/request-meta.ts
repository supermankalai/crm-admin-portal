import "server-only";
import { headers } from "next/headers";

export type RequestMeta = { ip: string | null; userAgent: string | null };

/** First hop of X-Forwarded-For (set by the reverse proxy in production), else X-Real-IP. */
export function metaFromHeaders(h: Headers): RequestMeta {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || null;
  const userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
  return { ip, userAgent };
}

export async function getRequestMeta(): Promise<RequestMeta> {
  return metaFromHeaders(await headers());
}
