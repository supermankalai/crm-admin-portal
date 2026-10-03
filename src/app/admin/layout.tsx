import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { requirePlatformAdmin } from "@/server/platform/guard";
import { logoutAction } from "../(auth)/actions";
import { AdminNav } from "./admin-nav";

export const metadata: Metadata = { title: { default: "Platform admin", template: "%s · Platform admin" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 md:px-6">
          <Link href="/admin" className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
              <ShieldCheck className="size-4" aria-hidden />
            </span>
            <span className="hidden sm:inline">FitCRM Platform</span>
          </Link>
          <div className="flex-1" />
          <span className="hidden text-sm text-muted-foreground md:inline">{admin.email}</span>
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/account">Account</Link>
          </Button>
          <form action={logoutAction}>
            <Button variant="outline" size="sm" type="submit">
              Log out
            </Button>
          </form>
        </div>
        <div className="mx-auto max-w-7xl overflow-x-auto px-4 md:px-6">
          <AdminNav />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
