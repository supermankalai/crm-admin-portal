import type { Metadata } from "next";
import Link from "next/link";
import { Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS, type GymRole } from "@/domain/permissions";
import { getSessionUser } from "@/server/auth/session";
import { lookupInvitation } from "@/server/services/invitations";
import { logoutAction } from "../../actions";
import { AcceptAsUser, AcceptWithNewAccount } from "./accept-form";

export const metadata: Metadata = { title: "Staff invitation", robots: { index: false } };

const STATE_TEXT = {
  expired: "This invitation has expired. Ask the gym to send you a new one.",
  used: "This invitation has already been used.",
  revoked: "This invitation was withdrawn by the gym.",
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invitation, user] = await Promise.all([lookupInvitation(token), getSessionUser()]);

  let body: React.ReactNode;
  if (!invitation) {
    body = <p className="text-sm text-muted-foreground">This invitation link is not valid. Check that you copied the whole link.</p>;
  } else if (invitation.state !== "valid") {
    body = <p className="text-sm text-muted-foreground">{STATE_TEXT[invitation.state]}</p>;
  } else if (user && user.email !== invitation.email) {
    body = (
      <div className="grid gap-3 text-sm">
        <p>
          This invitation is for <span className="font-medium">{invitation.email}</span>, but you&apos;re signed in as <span className="font-medium">{user.email}</span>.
        </p>
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            Sign out and continue
          </Button>
        </form>
      </div>
    );
  } else if (user) {
    body = <AcceptAsUser token={token} />;
  } else if (invitation.hasAccount) {
    body = (
      <div className="grid gap-3 text-sm">
        <p>
          You already have a FitCRM account for <span className="font-medium">{invitation.email}</span>. Sign in to accept.
        </p>
        <Button asChild>
          <Link href={`/login?callbackUrl=/invite/${token}`}>Sign in to accept</Link>
        </Button>
      </div>
    );
  } else {
    body = <AcceptWithNewAccount token={token} email={invitation.email} />;
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 p-6">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <Dumbbell className="size-5 text-primary" aria-hidden /> FitCRM
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl">{invitation ? `Join ${invitation.gymName}` : "Staff invitation"}</h1>
          </CardTitle>
          {invitation && invitation.state === "valid" && <CardDescription>You&apos;ve been invited as {ROLE_LABELS[invitation.role as GymRole]}.</CardDescription>}
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </main>
  );
}
