import "server-only";
import { createHash } from "node:crypto";
import { withAnonymous } from "@/server/db/context";
import { getEnv } from "@/server/env";

/**
 * Postgres-backed fixed-window rate limiting (works across multiple app instances).
 * Buckets are only reachable through the SECURITY DEFINER functions rate_limit_hit/reset.
 */

export type RateLimitRule = { name: string; limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  loginPerEmailIp: { name: "login:email-ip", limit: 5, windowSeconds: 15 * 60 },
  loginPerEmail: { name: "login:email", limit: 20, windowSeconds: 15 * 60 },
  get loginPerIp() {
    return { name: "login:ip", limit: getEnv().RATE_LIMIT_LOGIN_PER_IP, windowSeconds: 15 * 60 };
  },
  get signupPerIp() {
    return { name: "signup:ip", limit: getEnv().RATE_LIMIT_SIGNUP_PER_IP, windowSeconds: 60 * 60 };
  },
  passwordChangePerUser: { name: "password:user", limit: 5, windowSeconds: 15 * 60 },
  passwordResetPerIp: { name: "reset:ip", limit: 5, windowSeconds: 60 * 60 },
  passwordResetPerEmail: { name: "reset:email", limit: 3, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many attempts. Please wait and try again.");
    this.name = "RateLimitError";
  }
}

/** Identifiers such as emails are hashed so bucket keys never contain personal data. */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export function bucketKey(rule: RateLimitRule, ...parts: string[]) {
  return [rule.name, ...parts].join(":");
}

export async function hit(rule: RateLimitRule, ...parts: string[]) {
  const key = bucketKey(rule, ...parts);
  const rows = await withAnonymous((tx) =>
    tx.$queryRaw<{ allowed: boolean; remaining: number; retry_after_seconds: number }[]>`
      SELECT * FROM rate_limit_hit(${key}, ${rule.limit}::int, ${rule.windowSeconds}::int)`
  );
  const row = rows[0];
  return { allowed: row.allowed, remaining: row.remaining, retryAfterSeconds: row.retry_after_seconds };
}

/** Records hits against every rule; throws RateLimitError if any is exceeded. */
export async function enforce(checks: [RateLimitRule, ...string[]][]) {
  let retryAfter = 0;
  for (const [rule, ...parts] of checks) {
    const result = await hit(rule, ...parts);
    if (!result.allowed) retryAfter = Math.max(retryAfter, result.retryAfterSeconds);
  }
  if (retryAfter > 0) throw new RateLimitError(retryAfter);
}

export async function reset(rule: RateLimitRule, ...parts: string[]) {
  const key = bucketKey(rule, ...parts);
  // The function returns void, which $queryRaw cannot deserialize.
  await withAnonymous((tx) => tx.$executeRaw`SELECT rate_limit_reset(${key})`);
}
