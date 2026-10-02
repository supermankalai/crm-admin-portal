import "server-only";
import type { Permission } from "@/domain/permissions";
import { withTenant, type Tx } from "@/server/db/context";
import { ForbiddenError, GymReadOnlyError } from "@/server/errors";
import { READ_ONLY_MESSAGES } from "@/domain/subscription-access";
import type { TenantContext } from "./types";

export function hasPermission(ctx: TenantContext, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export function assertCan(ctx: TenantContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) throw new ForbiddenError();
}

/** Every mutation calls this: expired/suspended gyms and support sessions are read-only. */
export function assertWritable(ctx: TenantContext): void {
  if (ctx.supportSessionId) throw new GymReadOnlyError("Support access is read-only.");
  if (!ctx.access.writable) {
    throw new GymReadOnlyError(ctx.access.reason ? READ_ONLY_MESSAGES[ctx.access.reason] : undefined);
  }
}

/** Run queries in this gym's RLS context. The gym id comes from the verified context only. */
export function inTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) {
  return withTenant({ userId: ctx.user.id, gymId: ctx.gym.id, supportSessionId: ctx.supportSessionId }, fn);
}
