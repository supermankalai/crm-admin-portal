import { isIP } from "node:net";

/**
 * The client IP from an X-Forwarded-For header, trusting only the right-most `hops` entries.
 *
 * Each trusted proxy appends the address it received the request from, so with N proxies the
 * real client is the N-th entry from the right; everything to its left could have been sent by
 * the client. Without a proxy, Next.js fills the header with the socket address when it is
 * absent, so hops = 1 also fits direct connections in development.
 *
 * Returns null (the caller buckets these together) when the header is missing, too short for
 * the configured hops, or the entry isn't a valid IP address.
 */
export function clientIp(forwardedFor: string | null | undefined, hops: number): string | null {
  if (!forwardedFor || hops < 1) return null;
  const parts = forwardedFor
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < hops) return null;
  const candidate = parts[parts.length - hops].replace(/^\[|\]$/g, "").replace(/^::ffff:(?=\d+\.)/, "");
  return isIP(candidate) ? candidate : null;
}
