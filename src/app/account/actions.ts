"use server";

import { z } from "zod";
import { changePasswordSchema } from "@/lib/validation/auth";
import { toActionError, type ActionResult } from "@/server/actions/gym-action";
import { signOut } from "@/server/auth";
import { getSessionUser } from "@/server/auth/session";
import { RateLimitError } from "@/server/security/rate-limit";
import { getRequestMeta } from "@/server/security/request-meta";
import { changePassword, signOutEverywhere } from "@/server/services/account";

/** Change the password, then end this session too (every session was invalidated). */
export async function changePasswordAction(raw: unknown): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again.", code: "unauthenticated" };
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Please check the highlighted fields.", code: "validation", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  try {
    await changePassword(user.id, parsed.data, await getRequestMeta());
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: error.message, code: "rate_limited" };
    return toActionError(error);
  }
  await signOut({ redirectTo: "/login?notice=password-changed" });
  return { ok: true, data: undefined };
}

export async function signOutEverywhereAction(): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again.", code: "unauthenticated" };
  try {
    await signOutEverywhere(user.id, await getRequestMeta());
  } catch (error) {
    return toActionError(error);
  }
  await signOut({ redirectTo: "/login?notice=signed-out-everywhere" });
  return { ok: true, data: undefined };
}
