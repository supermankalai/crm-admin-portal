import "server-only";
import { appDb } from "./client";
import { runInContext, type DbContext, type Tx, type TxOptions } from "./run-in-context";

/**
 * Every database access in the app goes through one of these helpers. Each opens a
 * transaction and sets the RLS session variables with SET LOCAL semantics, so the
 * settings cannot leak to another request sharing the pooled connection.
 *
 * Tenant ids come from a server-verified context object (see src/server/tenant), never
 * from user input.
 */

export type { DbContext, Tx } from "./run-in-context";

/** No user yet: login, rate limiting, platform audit inserts. RLS hides all tenant rows. */
export function withAnonymous<T>(fn: (tx: Tx) => Promise<T>, options?: TxOptions) {
  return runInContext(appDb, {}, fn, options);
}

/** A signed-in user outside any gym: own profile, own gym list. */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, options?: TxOptions) {
  return runInContext(appDb, { userId }, fn, options);
}

/** A signed-in user acting inside one gym. Use only with a context from requireGymAccess(). */
export function withTenant<T>(
  ctx: { userId: string; gymId: string; supportSessionId?: string | null },
  fn: (tx: Tx) => Promise<T>,
  options?: TxOptions
) {
  return runInContext(appDb, ctx, fn, options);
}

/** A verified super admin in the platform area. Grants platform tables only — never tenant rows. */
export function withPlatformAdmin<T>(userId: string, fn: (tx: Tx) => Promise<T>, options?: TxOptions) {
  return runInContext(appDb, { userId, platformAdmin: true }, fn, options);
}

export type { DbContext as RlsContext };
