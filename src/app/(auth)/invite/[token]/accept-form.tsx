"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { newAccountForInviteSchema } from "@/lib/validation/staff";
import { acceptInvitationAction } from "./actions";

type Values = z.input<typeof newAccountForInviteSchema>;

export function AcceptAsUser({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-2">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await acceptInvitationAction(token, {});
            if (r && !r.ok) setError(r.error);
          })
        }
      >
        {pending && <Loader2 className="animate-spin" aria-hidden />} Accept invitation
      </Button>
    </div>
  );
}

export function AcceptWithNewAccount({ token, email }: { token: string; email: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({ resolver: zodResolver(newAccountForInviteSchema), defaultValues: { name: "", password: "", confirmPassword: "" } });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit(() =>
        startTransition(async () => {
          setError(null);
          const r = await acceptInvitationAction(token, form.getValues());
          if (r && !r.ok) setError(r.error);
        })
      )}
    >
      <div className="grid gap-2">
        <Label htmlFor="invite-account-email">Email</Label>
        <Input id="invite-account-email" value={email} readOnly disabled />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="invite-name">Your full name</Label>
        <Input id="invite-name" autoComplete="name" {...form.register("name")} aria-invalid={!!e.name} />
        {e.name && <p className="text-sm text-destructive">{e.name.message}</p>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="invite-password">Password</Label>
        <Input id="invite-password" type="password" autoComplete="new-password" {...form.register("password")} aria-invalid={!!e.password} />
        <p className="text-xs text-muted-foreground">At least 10 characters, with upper and lower case letters and a number.</p>
        {e.password && <p className="text-sm text-destructive">{e.password.message}</p>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="invite-confirm">Confirm password</Label>
        <Input id="invite-confirm" type="password" autoComplete="new-password" {...form.register("confirmPassword")} aria-invalid={!!e.confirmPassword} />
        {e.confirmPassword && <p className="text-sm text-destructive">{e.confirmPassword.message}</p>}
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />} Create account &amp; join
      </Button>
    </form>
  );
}
