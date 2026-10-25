import "server-only";
import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { getEnv } from "@/server/env";

export type RequestMeta = { ip: string | null; userAgent: string | null };

/**
 * Client IP and user agent for rate limiting and audit entries. The IP comes from
 * X-Forwarded-For, counting TRUSTED_PROXY_HOPS entries from the right (see lib/client-ip):
 * entries further left were supplied by the client and are never trusted.
 */
export function metaFromHeaders(h: Headers): RequestMeta {
  const ip = clientIp(h.get("x-forwarded-for"), getEnv().TRUSTED_PROXY_HOPS);
  const userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
  return { ip, userAgent };
}

export async function getRequestMeta(): Promise<RequestMeta> {
  return metaFromHeaders(await headers());
}
