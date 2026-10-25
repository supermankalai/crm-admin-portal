"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { loginSchema } from "@/lib/validation/auth";
import { signIn } from "@/server/auth";
import { safeRedirectPath } from "@/lib/safe-redirect";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  try {
    await signIn("credentials", {
      ...parsed.data,
      redirectTo: safeRedirectPath(formData.get("callbackUrl"), "/"),
    });
    return {};
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      return error.code === "rate_limited"
        ? { error: "Too many sign-in attempts. Please wait 15 minutes and try again." }
        : { error: "Invalid email or password." };
    }
    if (error instanceof AuthError) return { error: "Sign-in failed. Please try again." };
    throw error; // includes the NEXT_REDIRECT thrown on success
  }
}
