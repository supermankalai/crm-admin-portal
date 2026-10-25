"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { CredentialsSignin } from "next-auth";
import { z } from "zod";
import { newAccountForInviteSchema } from "@/lib/validation/staff";
import { toActionError, type ActionResult } from "@/server/actions/gym-action";
import { signIn } from "@/server/auth";
import { getSessionUser } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";
import { enforce, RATE_LIMITS, RateLimitError } from "@/server/security/rate-limit";
import { getRequestMeta } from "@/server/security/request-meta";
import { acceptInvitationAsUser, acceptInvitationWithNewAccount, lookupInvitation } from "@/server/services/invitations";

const tokenSchema = z.string().regex(/^[\w-]{20,100}$/);

/** Accept an invitation: as the signed-in user, or by creating an account for the invited email. */
export async function acceptInvitationAction(token: string, raw: unknown): Promise<ActionResult> {
  try {
    if (!tokenSchema.safeParse(token).success) throw new ValidationError("This invitation link is not valid.");
    const meta = await getRequestMeta();
    try {
      await enforce([[RATE_LIMITS.signupPerIp, meta.ip ?? "unknown"]]);
    } catch (error) {
      if (error instanceof RateLimitError) return { ok: false, code: "rate_limited", error: "Too many attempts from this network. Please try again later." };
      throw error;
    }

    const user = await getSessionUser();
    if (user) {
      const r = await acceptInvitationAsUser(user.id, token);
      redirect(`/g/${r!.gymSlug}/dashboard`);
    }

    const parsed = newAccountForInviteSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError("Please check the highlighted fields.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
    const invitation = await lookupInvitation(token);
    const r = await acceptInvitationWithNewAccount(token, parsed.data.name, parsed.data.password);
    try {
      await signIn("credentials", { email: invitation!.email, password: parsed.data.password, redirectTo: `/g/${r!.gymSlug}/dashboard` });
    } catch (error) {
      if (error instanceof CredentialsSignin) redirect(`/login?callbackUrl=/g/${r!.gymSlug}/dashboard`);
      throw error;
    }
    return { ok: true, data: undefined };
  } catch (error) {
    unstable_rethrow(error);
    return toActionError(error);
  }
}
