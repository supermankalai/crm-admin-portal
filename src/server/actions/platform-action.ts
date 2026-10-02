import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { SessionUser } from "@/server/auth/session";
import { NotFoundError, ValidationError } from "@/server/errors";
import { getPlatformAdmin } from "@/server/platform/guard";
import { toActionError, type ActionResult } from "./gym-action";

/** Super admin server actions: verified super admin (from the DB) + Zod-validated input. */
export function platformAction<S extends z.ZodType, R>(schema: S, handler: (admin: SessionUser, input: z.infer<S>) => Promise<R>) {
  return async (rawInput: unknown): Promise<ActionResult<R>> => {
    try {
      const admin = await getPlatformAdmin();
      if (!admin) throw new NotFoundError();
      const parsed = schema.safeParse(rawInput);
      if (!parsed.success) {
        throw new ValidationError("Please check the highlighted fields.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
      }
      return { ok: true, data: await handler(admin, parsed.data) };
    } catch (error) {
      unstable_rethrow(error);
      return toActionError(error);
    }
  };
}
