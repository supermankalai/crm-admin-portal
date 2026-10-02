import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { Permission } from "@/domain/permissions";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { assertCan, assertWritable, getGymAccess, type TenantContext } from "@/server/tenant";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]> };

type Options<S extends z.ZodType> = {
  permission: Permission;
  schema: S;
  /** Mutations: blocked when the gym is read-only (expired/suspended) or in support mode. */
  write: boolean;
};

/**
 * Wraps every gym server action: resolve + verify the tenant from the session (the slug only
 * selects which of the user's gyms), check the permission, block writes on read-only gyms,
 * validate input with the shared Zod schema, and turn failures into friendly results.
 */
export function gymAction<S extends z.ZodType, R>(
  options: Options<S>,
  handler: (ctx: TenantContext, input: z.infer<S>) => Promise<R>
) {
  return async (gymSlug: string, rawInput: unknown): Promise<ActionResult<R>> => {
    try {
      const ctx = await getGymAccess(String(gymSlug));
      if (!ctx) throw new NotFoundError("This gym was not found or you no longer have access to it.");
      assertCan(ctx, options.permission);
      if (options.write) assertWritable(ctx);

      const parsed = options.schema.safeParse(rawInput);
      if (!parsed.success) {
        throw new ValidationError("Please check the highlighted fields.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
      }
      return { ok: true, data: await handler(ctx, parsed.data) };
    } catch (error) {
      unstable_rethrow(error); // let redirect()/notFound() from handlers propagate
      return toActionError(error);
    }
  };
}

export function toActionError(error: unknown): { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]> } {
  if (error instanceof ValidationError) return { ok: false, error: error.message, code: error.code, fieldErrors: error.fieldErrors };
  if (error instanceof ForbiddenError) return { ok: false, error: error.message, code: error.code };
  if (error instanceof AppError) return { ok: false, error: error.message, code: error.code };
  logger.error("server action failed", { error });
  return { ok: false, error: "Something went wrong. Please try again.", code: "internal" };
}
