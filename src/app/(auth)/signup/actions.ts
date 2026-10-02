"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { signupExistingUserSchema, signupNewUserSchema } from "@/lib/validation/signup";
import { signIn } from "@/server/auth";
import { getSessionUser } from "@/server/auth/session";
import { toActionError, type ActionResult } from "@/server/actions/gym-action";
import { ValidationError } from "@/server/errors";
import { enforce, RATE_LIMITS, RateLimitError } from "@/server/security/rate-limit";
import { getRequestMeta } from "@/server/security/request-meta";
import { signupForExistingUser, signupWithNewOwner } from "@/server/services/signup";

/**
 * Create a gym + owner + 14-day trial. Validates with the same Zod schemas as the wizard.
 * On success it redirects into the new gym (signing a new owner in first).
 */
export async function signupAction(raw: unknown): Promise<ActionResult> {
  try {
    const meta = await getRequestMeta();
    try {
      await enforce([[RATE_LIMITS.signupPerIp, meta.ip ?? "unknown"]]);
    } catch (error) {
      if (error instanceof RateLimitError) {
        return { ok: false, code: "rate_limited", error: "Too many sign-ups from this network. Please try again in an hour." };
      }
      throw error;
    }

    const user = await getSessionUser();
    if (user) {
      const parsed = signupExistingUserSchema.safeParse(raw);
      if (!parsed.success) throw new ValidationError("Please check the highlighted fields.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
      await signupForExistingUser(user.id, parsed.data, meta);
      redirect(`/g/${parsed.data.slug}/dashboard`);
    }

    const parsed = signupNewUserSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the highlighted fields.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
    const { email, password, ownerName, ...gym } = parsed.data;
    await signupWithNewOwner(gym, { email, password, ownerName }, meta);
    await signIn("credentials", { email, password, redirectTo: `/g/${gym.slug}/dashboard` });
    return { ok: true, data: undefined };
  } catch (error) {
    unstable_rethrow(error);
    return toActionError(error);
  }
}
