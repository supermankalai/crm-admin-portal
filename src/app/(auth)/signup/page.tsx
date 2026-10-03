import type { Metadata } from "next";
import Link from "next/link";
import { Dumbbell } from "lucide-react";
import { getSessionUser } from "@/server/auth/session";
import { listPublicPlans } from "@/server/services/platform-plans";
import { timeZones } from "@/lib/validation/settings";
import { SignupWizard } from "./signup-wizard";

export const metadata: Metadata = { title: "Start your free trial" };

export default async function SignupPage() {
  const [user, plans] = await Promise.all([getSessionUser(), listPublicPlans()]);
  // Includes the default (Asia/Kolkata), which ICU lists only under its old name.
  const timezones = timeZones("Asia/Kolkata");

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Dumbbell className="size-5 text-primary" aria-hidden /> FitCRM
        </Link>
        {!user && (
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login?callbackUrl=/signup" className="font-medium text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        )}
      </header>
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Start your 14-day free trial</h1>
        <p className="mt-1 text-muted-foreground">
          {user ? `Add a new gym to your account (${user.email}).` : "Set up your gym in under two minutes. No card required."}
        </p>
      </div>
      <SignupWizard
        plans={plans}
        timezones={timezones}
        signedInAs={user ? { name: user.name, email: user.email } : null}
      />
    </main>
  );
}
