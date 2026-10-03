import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronRight, LogOut, Plus, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/domain/permissions";
import { requireUser } from "@/server/auth/session";
import { listMyGyms } from "@/server/services/my-gyms";
import { logoutAction } from "../(auth)/actions";

export const metadata: Metadata = { title: "Choose a gym" };


export default async function SelectGymPage() {
  const user = await requireUser();
  const gyms = await listMyGyms(user.id);

  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Welcome, {user.name}</h1>
          <p className="text-sm text-muted-foreground">
            {user.email} ·{" "}
            <Link href="/account" className="underline-offset-4 hover:underline">
              Account &amp; security
            </Link>
          </p>
        </div>
        <form action={logoutAction}>
          <Button variant="outline" size="sm" type="submit">
            <LogOut aria-hidden /> Log out
          </Button>
        </form>
      </div>

      {user.isSuperAdmin && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden /> Platform administrator
            </CardTitle>
            <CardDescription>Manage gyms, plans and subscriptions.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/admin">Open platform admin</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your gyms</CardTitle>
          <CardDescription>
            {gyms.length ? "Choose the gym you want to work in." : "You are not a staff member of any gym yet."}
          </CardDescription>
        </CardHeader>
        {gyms.length > 0 && (
          <CardContent className="grid gap-2">
            {gyms.map(({ gym, role }) => (
              <Link
                key={gym.id}
                href={`/g/${gym.slug}/dashboard`}
                className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span
                  className="flex size-9 items-center justify-center rounded-md text-white"
                  style={{ backgroundColor: gym.brandColor }}
                  aria-hidden
                >
                  <Building2 className="size-4" />
                </span>
                <span className="flex-1">
                  <span className="block font-medium">{gym.name}</span>
                  <span className="block text-xs text-muted-foreground">/g/{gym.slug}</span>
                </span>
                <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </CardContent>
        )}
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/signup">
              <Plus aria-hidden /> Create a new gym
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
