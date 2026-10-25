"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Loader2, MailPlus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { UpgradeNotice } from "@/components/upgrade-notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ROLE_LABELS, type GymRole } from "@/domain/permissions";
import { inviteSchema } from "@/lib/validation/staff";
import { inviteStaffAction } from "./actions";

export function InviteDialog({ gymSlug, roles, canManageBilling }: { gymSlug: string; roles: GymRole[]; canManageBilling: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof inviteSchema>, unknown, z.output<typeof inviteSchema>>({ resolver: zodResolver(inviteSchema), defaultValues: { email: "", role: roles.includes("TRAINER") ? "TRAINER" : roles[0] } });

  const close = (o: boolean) => {
    if (pending) return;
    setOpen(o);
    if (!o) {
      setLink(null);
      setLimit(null);
      form.reset();
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <MailPlus aria-hidden /> Invite staff
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          {link ? (
            <div className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Invitation sent</DialogTitle>
                <DialogDescription>We emailed the link. You can also share it directly — it works once and expires in 7 days. It won&apos;t be shown again.</DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <Input readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link);
                    toast.success("Link copied.");
                  }}
                >
                  <Copy aria-hidden /> Copy
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => close(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              noValidate
              className="grid gap-4"
              onSubmit={form.handleSubmit(() =>
                startTransition(async () => {
                  setLimit(null);
                  const r = await inviteStaffAction(gymSlug, form.getValues());
                  if (!r.ok) {
                    if (r.code === "plan_limit") return setLimit(r.error);
                    for (const [f, m] of Object.entries(r.fieldErrors ?? {})) if (m?.[0]) form.setError(f as "email", { message: m[0] });
                    return void toast.error(r.error);
                  }
                  setLink(r.data.link);
                  router.refresh();
                })
              )}
            >
              <DialogHeader>
                <DialogTitle>Invite a staff member</DialogTitle>
                <DialogDescription>They&apos;ll get an email link to create an account (or sign in) and join this gym.</DialogDescription>
              </DialogHeader>
              {limit && <UpgradeNotice message={limit} canManageBilling={canManageBilling} />}
              <div className="grid gap-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input id="invite-email" type="email" autoComplete="off" {...form.register("email")} aria-invalid={!!form.formState.errors.email} />
                {form.formState.errors.email && <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-role">Role</Label>
                <NativeSelect id="invite-role" {...form.register("role")}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" aria-hidden />} Send invitation
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
