"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, LogOut } from "lucide-react";
import type { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordSchema } from "@/lib/validation/auth";
import { changePasswordAction, signOutEverywhereAction } from "./actions";

type Values = z.input<typeof changePasswordSchema>;

export function ChangePasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });
  const e = form.formState.errors;
  const field = (name: keyof Values, label: string, autoComplete: string, hint?: string) => (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} type="password" autoComplete={autoComplete} {...form.register(name)} aria-invalid={!!e[name]} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {e[name] && <p className="text-sm text-destructive">{e[name]?.message}</p>}
    </div>
  );

  return (
    <form
      noValidate
      className="grid max-w-sm gap-4"
      onSubmit={form.handleSubmit(() =>
        startTransition(async () => {
          setError(null);
          const r = await changePasswordAction(form.getValues());
          if (r && !r.ok) {
            for (const [name, messages] of Object.entries(r.fieldErrors ?? {})) if (messages?.[0]) form.setError(name as keyof Values, { message: messages[0] });
            setError(r.error);
          }
        })
      )}
    >
      {field("currentPassword", "Current password", "current-password")}
      {field("newPassword", "New password", "new-password", "At least 10 characters, with upper and lower case letters and a number.")}
      {field("confirmPassword", "Confirm new password", "new-password")}
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />} Change password
        </Button>
      </div>
    </form>
  );
}

export function SignOutEverywhere() {
  return (
    <ConfirmDialog
      title="Sign out on all devices?"
      description="Every session ends immediately, including this one. You'll need to sign in again."
      confirmLabel="Sign out everywhere"
      trigger={(open) => (
        <Button variant="outline" onClick={open}>
          <LogOut aria-hidden /> Sign out everywhere
        </Button>
      )}
      onConfirm={async () => {
        const r = await signOutEverywhereAction();
        return !!r?.ok;
      }}
    />
  );
}
