"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { memberNoteSchema } from "@/lib/validation/members";
import { addNoteAction } from "../actions";

export function NoteForm({ gymSlug, memberId }: { gymSlug: string; memberId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof memberNoteSchema>>({ resolver: zodResolver(memberNoteSchema), defaultValues: { memberId, body: "" } });
  return (
    <form
      noValidate
      className="grid gap-2"
      onSubmit={form.handleSubmit((values) =>
        startTransition(async () => {
          const r = await addNoteAction(gymSlug, values);
          if (!r.ok) return void toast.error(r.error);
          form.reset({ memberId, body: "" });
          toast.success("Note added.");
          router.refresh();
        })
      )}
    >
      <Label htmlFor="note-body">Add a staff note</Label>
      <Textarea id="note-body" rows={3} placeholder="Visible to staff only. Stored encrypted." {...form.register("body")} aria-invalid={!!form.formState.errors.body} />
      {form.formState.errors.body && <p className="text-sm text-destructive">{form.formState.errors.body.message}</p>}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />} Add note
        </Button>
      </div>
    </form>
  );
}
