import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Dumbbell } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getSessionUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  if (await getSessionUser()) redirect(safeRedirectPath(callbackUrl, "/"));

  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between bg-zinc-950 p-10 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Dumbbell className="size-6 text-orange-500" aria-hidden /> FitCRM
        </div>
        <div className="space-y-3">
          <h2 className="text-3xl font-bold">Run every gym from one secure platform.</h2>
          <p className="max-w-md text-zinc-400">
            Members, memberships, payments, check-ins and classes, with each gym&apos;s data kept strictly separate.
          </p>
        </div>
        <p className="text-sm text-zinc-500">© {new Date().getFullYear()} FitCRM</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <div className="mb-2 flex items-center gap-2 font-semibold lg:hidden">
              <Dumbbell className="size-5 text-primary" aria-hidden /> FitCRM
            </div>
            <CardTitle>
              <h1 className="text-2xl">Sign in</h1>
            </CardTitle>
            <CardDescription>Use your staff or platform account.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm callbackUrl={safeRedirectPath(callbackUrl, "/")} />
            <p className="mt-4 text-center text-sm text-muted-foreground">
              New to FitCRM?{" "}
              <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
                Start a free trial
              </Link>
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
