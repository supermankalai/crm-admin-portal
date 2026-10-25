"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { UpgradeNotice } from "@/components/upgrade-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { memberContactUpdateSchema, memberSchema, type MemberFormValues, type MemberInput } from "@/lib/validation/members";
import { createMemberAction, updateMemberAction } from "@/app/g/[gymSlug]/members/actions";

type Mode = { kind: "create" } | { kind: "edit"; memberId: string; contactOnly: boolean };

const EMPTY: MemberFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  dateOfBirth: "",
  healthNotes: "",
  emergencyContact: { name: "", phone: "", relation: "" },
};

function err(errors: FieldErrors<MemberFormValues>, path: string): string | undefined {
  const parts = path.split(".");
  let node: unknown = errors;
  for (const p of parts) node = (node as Record<string, unknown> | undefined)?.[p];
  return (node as { message?: string } | undefined)?.message;
}

export function MemberForm({ gymSlug, mode, defaults, canManageBilling }: { gymSlug: string; mode: Mode; defaults?: MemberFormValues; canManageBilling: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [planLimit, setPlanLimit] = useState<string | null>(null);
  const contactOnly = mode.kind === "edit" && mode.contactOnly;
  const schema = contactOnly ? memberContactUpdateSchema.omit({ memberId: true }) : memberSchema;
  const form = useForm<MemberFormValues, unknown, MemberInput>({
    // Same schema the server validates with; contact-only staff get the contact subset.
    resolver: zodResolver(schema as typeof memberSchema),
    defaultValues: { ...EMPTY, ...defaults },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(() =>
    startTransition(async () => {
      setPlanLimit(null);
      // Send the raw form values: the server action validates them again with the same schema
      // (sending the already-transformed output would fail that second parse).
      const raw = form.getValues();
      const payload = contactOnly ? { email: raw.email, phone: raw.phone, address: raw.address, emergencyContact: raw.emergencyContact } : raw;
      const result = mode.kind === "create" ? await createMemberAction(gymSlug, payload) : await updateMemberAction(gymSlug, { ...payload, memberId: mode.memberId });
      if (!result.ok) {
        if (result.code === "plan_limit") return setPlanLimit(result.error);
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (messages?.[0]) form.setError(field as keyof MemberFormValues, { message: messages[0] });
        }
        toast.error(result.error);
        return;
      }
      const id = mode.kind === "create" ? (result.data as { id: string }).id : mode.memberId;
      toast.success(mode.kind === "create" ? "Member added." : "Changes saved.");
      router.push(`/g/${gymSlug}/members/${id}`);
      router.refresh();
    })
  );

  const field = (name: string, label: string, props: React.ComponentProps<typeof Input> = {}, hint?: string) => {
    const message = err(errors, name);
    const id = name.replace(".", "-");
    return (
      <div className="grid gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Input id={id} aria-invalid={!!message} aria-describedby={`${id}-msg`} {...props} {...form.register(name as keyof MemberFormValues)} />
        {(message || hint) && (
          <p id={`${id}-msg`} className={message ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
            {message ?? hint}
          </p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {planLimit && <UpgradeNotice message={planLimit} canManageBilling={canManageBilling} />}
      {!contactOnly && (
        <Card>
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {field("firstName", "First name", { autoComplete: "given-name" })}
            {field("lastName", "Last name", { autoComplete: "family-name" })}
            {field("dateOfBirth", "Date of birth", { type: "date" }, "Optional. Stored encrypted.")}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
          <CardDescription>Phone and address are stored encrypted.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("phone", "Phone", { type: "tel", autoComplete: "tel" })}
          {field("email", "Email", { type: "email", autoComplete: "email" }, "Must be unique within this gym.")}
          <div className="sm:col-span-2">{field("address", "Address", { autoComplete: "street-address" })}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Emergency contact</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {field("emergencyContact.name", "Contact name")}
          {field("emergencyContact.phone", "Contact phone", { type: "tel" })}
          {field("emergencyContact.relation", "Relationship", { placeholder: "e.g. Spouse" })}
        </CardContent>
      </Card>
      {!contactOnly && (
        <Card>
          <CardHeader>
            <CardTitle>Health notes</CardTitle>
            <CardDescription>Injuries, conditions or anything trainers should know. Stored encrypted.</CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="healthNotes" className="sr-only">
              Health notes
            </Label>
            <Textarea id="healthNotes" rows={4} aria-invalid={!!errors.healthNotes} {...form.register("healthNotes")} />
            {errors.healthNotes && <p className="mt-1 text-sm text-destructive">{errors.healthNotes.message}</p>}
          </CardContent>
        </Card>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {mode.kind === "create" ? "Add member" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
