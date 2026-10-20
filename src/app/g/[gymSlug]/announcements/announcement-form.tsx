"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Megaphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ANNOUNCEMENT_AUDIENCES, announcementSchema, AUDIENCE_LABELS, type AnnouncementFormValues, type AnnouncementInput } from "@/lib/validation/announcements";
import { deleteAnnouncementAction, publishAnnouncementAction } from "./actions";

const EMPTY: AnnouncementFormValues = { title: "", body: "", audience: "EVERYONE" };

/** Compose and publish. Members get it in the app's inbox and as a push alert (title only). */
export function AnnouncementForm({ gymSlug }: { gymSlug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<AnnouncementFormValues, unknown, AnnouncementInput>({ resolver: zodResolver(announcementSchema), defaultValues: EMPTY });
  const errors = form.formState.errors;
  const body = useWatch({ control: form.control, name: "body" }) ?? "";

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const r = await publishAnnouncementAction(gymSlug, values);
      if (!r.ok) {
        for (const [field, messages] of Object.entries(r.fieldErrors ?? {})) if (messages?.[0]) form.setError(field as keyof AnnouncementFormValues, { message: messages[0] });
        return void toast.error(r.error);
      }
      toast.success(r.data.recipients === 1 ? "Published to 1 person." : `Published to ${r.data.recipients} people.`);
      form.reset(EMPTY);
      router.refresh();
    })
  );

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="ann-title">Title</Label>
        <Input id="ann-title" maxLength={120} aria-invalid={!!errors.title} aria-describedby="ann-title-help ann-title-error" {...form.register("title")} />
        <p id="ann-title-help" className="text-xs text-muted-foreground">
          Shown on members&apos; lock screens — don&apos;t include anyone&apos;s personal details.
        </p>
        <p id="ann-title-error" role="alert" className="text-sm text-destructive">
          {errors.title?.message}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="ann-body">Message</Label>
        <Textarea id="ann-body" rows={5} maxLength={2000} aria-invalid={!!errors.body} aria-describedby="ann-body-count ann-body-error" {...form.register("body")} />
        <p id="ann-body-count" className="text-xs text-muted-foreground" aria-live="polite">
          {body.length} / 2000 characters
        </p>
        <p id="ann-body-error" role="alert" className="text-sm text-destructive">
          {errors.body?.message}
        </p>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Who should see it?</legend>
        {ANNOUNCEMENT_AUDIENCES.map((a) => (
          <label key={a} className="flex items-center gap-2 text-sm">
            <input type="radio" value={a} className="size-4" {...form.register("audience")} /> {AUDIENCE_LABELS[a]}
          </label>
        ))}
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Megaphone aria-hidden />} Publish
        </Button>
      </div>
    </form>
  );
}

export function DeleteAnnouncementButton({ gymSlug, id, title }: { gymSlug: string; id: string; title: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      title={`Delete “${title}”?`}
      description="It disappears from the app's announcements list. Copies already delivered to people's inboxes stay."
      confirmLabel="Delete announcement"
      onConfirm={async () => {
        const r = await deleteAnnouncementAction(gymSlug, { announcementId: id });
        if (!r.ok) {
          toast.error(r.error);
          return false;
        }
        toast.success("Announcement deleted.");
        router.refresh();
        return true;
      }}
      trigger={(open) => (
        <Button variant="ghost" size="sm" onClick={open} aria-label={`Delete ${title}`}>
          <Trash2 aria-hidden /> Delete
        </Button>
      )}
    />
  );
}
