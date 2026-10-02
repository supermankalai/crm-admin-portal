"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supportStartSchema, type SupportStartInput } from "@/lib/validation/platform";
import { startSupportAction } from "../../actions";

/** Starting support access is a deliberate, logged act with a mandatory reason. */
export function SupportAccessForm({ gymId, gymName }: { gymId: string; gymName: string }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<SupportStartInput>({ resolver: zodResolver(supportStartSchema), defaultValues: { gymId, reason: "" } });

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await startSupportAction(values);
      if (result && !result.ok) toast.error(result.error); // on success the action redirects into the gym
    })
  );

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="support-reason">Reason for accessing {gymName}&apos;s data</Label>
        <Textarea
          id="support-reason"
          rows={3}
          placeholder="e.g. Ticket #4821 — owner reports members missing from the check-in list"
          aria-invalid={!!form.formState.errors.reason}
          aria-describedby="support-reason-help support-reason-error"
          {...form.register("reason")}
        />
        <p id="support-reason-help" className="text-xs text-muted-foreground">
          Read-only, ends after 60 minutes, and every page you open is recorded in the gym&apos;s own audit log.
        </p>
        {form.formState.errors.reason && (
          <p id="support-reason-error" className="text-sm text-destructive">
            {form.formState.errors.reason.message}
          </p>
        )}
      </div>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Eye aria-hidden />} Start support access
        </Button>
      </div>
    </form>
  );
}
