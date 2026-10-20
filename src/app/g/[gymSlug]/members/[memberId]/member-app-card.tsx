"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, MessageSquare, Smartphone, Ticket } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inviteToAppAction, setAppAccessAction } from "../actions";

type Props = {
  gymSlug: string;
  memberId: string;
  firstName: string;
  status: "ACTIVE" | "DISABLED" | null;
  lastLogin: string | null;
  pendingInvite: { channel: string; expires: string } | null;
  hasEmail: boolean;
  hasPhone: boolean;
  canManage: boolean;
};

/** Member app status on the web profile: invite (email, SMS or a code to read out) and access. */
export function MemberAppCard(p: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<{ code: string; expires: string } | null>(null);

  const invite = (channel: "EMAIL" | "SMS" | "CODE") =>
    startTransition(async () => {
      const r = await inviteToAppAction(p.gymSlug, { memberId: p.memberId, channel });
      if (!r.ok) return void toast.error(r.error);
      if (r.data.code) setCode({ code: r.data.code, expires: new Date(r.data.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) });
      else toast.success(`Invite sent to ${r.data.sentTo}.`);
      router.refresh();
    });

  const setAccess = async (enabled: boolean) => {
    const r = await setAppAccessAction(p.gymSlug, { memberId: p.memberId, enabled });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success(enabled ? "App access turned back on." : "App access turned off.");
    router.refresh();
    return true;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-4" aria-hidden /> Member app
        </CardTitle>
        <CardDescription>Their card, class bookings, workouts and progress on their phone.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {p.status === "ACTIVE" ? (
            <>
              <Badge variant="success">Using the app</Badge>
              {p.lastLogin && <span className="text-muted-foreground">Last signed in {p.lastLogin}</span>}
            </>
          ) : p.status === "DISABLED" ? (
            <Badge variant="danger">App access off</Badge>
          ) : p.pendingInvite ? (
            <>
              <Badge variant="info">Invited</Badge>
              <span className="text-muted-foreground">
                By {p.pendingInvite.channel.toLowerCase()}, valid until {p.pendingInvite.expires}
              </span>
            </>
          ) : (
            <Badge variant="outline">Not set up</Badge>
          )}
        </div>

        {code && (
          <div role="status" className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm">Ask {p.firstName} to tap “I have an invite” in the app and enter:</p>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-widest">{code.code}</p>
            <p className="mt-1 text-xs text-muted-foreground">Works once, until {code.expires}. It isn&apos;t shown again.</p>
          </div>
        )}

        {p.canManage && p.status !== "ACTIVE" && p.status !== "DISABLED" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => invite("EMAIL")} disabled={pending || !p.hasEmail} title={p.hasEmail ? undefined : "Add an email address first"}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Mail aria-hidden />} Email invite
            </Button>
            <Button variant="outline" size="sm" onClick={() => invite("SMS")} disabled={pending || !p.hasPhone} title={p.hasPhone ? undefined : "Add a mobile number first"}>
              <MessageSquare aria-hidden /> Text invite
            </Button>
            <Button variant="outline" size="sm" onClick={() => invite("CODE")} disabled={pending || (!p.hasEmail && !p.hasPhone)}>
              <Ticket aria-hidden /> Show a code
            </Button>
          </div>
        )}

        {p.canManage && p.status === "ACTIVE" && (
          <ConfirmDialog
            title={`Turn off app access for ${p.firstName}?`}
            description="They're signed out of the app on their next action and can't sign in to this gym until you turn it back on. Their membership isn't affected."
            confirmLabel="Turn off app access"
            onConfirm={() => setAccess(false)}
            trigger={(open) => (
              <div>
                <Button variant="outline" size="sm" onClick={open}>
                  Turn off app access
                </Button>
              </div>
            )}
          />
        )}
        {p.canManage && p.status === "DISABLED" && (
          <div>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(async () => void (await setAccess(true)))}>
              Turn app access back on
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
