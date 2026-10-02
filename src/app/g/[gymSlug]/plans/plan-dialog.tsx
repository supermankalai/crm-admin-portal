"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_DURATION, membershipPlanSchema, PLAN_TYPES, type MembershipPlanFormValues, type MembershipPlanInput } from "@/lib/validation/plans";
import { saveMembershipPlanAction } from "./actions";

const TYPE_LABELS: Record<(typeof PLAN_TYPES)[number], string> = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", YEARLY: "Yearly", CLASS_PACK: "Class pack" };

const NEW_PLAN: MembershipPlanFormValues = {
  name: "",
  description: "",
  type: "MONTHLY",
  price: "",
  durationDays: 30,
  classCredits: "",
  allowFreeze: false,
  maxFreezeDays: 0,
  cancellationNoticeDays: 0,
  cancellationFee: "0",
  isActive: true,
};

export function PlanDialog({ gymSlug, currency, plan }: { gymSlug: string; currency: string; plan?: MembershipPlanFormValues & { planId: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<MembershipPlanFormValues, unknown, MembershipPlanInput>({ resolver: zodResolver(membershipPlanSchema), defaultValues: plan ?? NEW_PLAN });
  const errors = form.formState.errors;
  const type = useWatch({ control: form.control, name: "type" });
  const allowFreeze = useWatch({ control: form.control, name: "allowFreeze" });
  const id = (f: string) => `${plan?.planId ?? "new"}-${f}`;

  const msg = (f: keyof MembershipPlanFormValues) => {
    const message = errors[f]?.message;
    return message ? <p className="text-sm text-destructive">{message}</p> : null;
  };

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveMembershipPlanAction(gymSlug, { ...form.getValues(), planId: plan?.planId });
      if (!result.ok) {
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (messages?.[0]) form.setError(field as keyof MembershipPlanFormValues, { message: messages[0] });
        }
        return void toast.error(result.error);
      }
      toast.success(`${values.name} saved.`);
      setOpen(false);
      if (!plan) form.reset(NEW_PLAN);
      router.refresh();
    })
  );

  return (
    <>
      {plan ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Edit ${plan.name}`}>
          <Pencil aria-hidden /> Edit
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden /> New plan
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={submit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{plan ? `Edit ${plan.name}` : "New membership plan"}</DialogTitle>
              <DialogDescription>Price changes apply to new sales only — existing memberships keep the price they were sold at.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={id("name")}>Name</Label>
                <Input id={id("name")} {...form.register("name")} aria-invalid={!!errors.name} />
                {msg("name")}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={id("type")}>Type</Label>
                <NativeSelect
                  id={id("type")}
                  {...form.register("type", {
                    onChange: (e) => form.setValue("durationDays", DEFAULT_DURATION[e.target.value as keyof typeof DEFAULT_DURATION]),
                  })}
                >
                  {PLAN_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={id("price")}>Price ({currency})</Label>
                <Input id={id("price")} inputMode="decimal" placeholder="2500" {...form.register("price")} aria-invalid={!!errors.price} />
                {msg("price")}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={id("durationDays")}>{type === "CLASS_PACK" ? "Valid for (days)" : "Duration (days)"}</Label>
                <Input id={id("durationDays")} type="number" min={1} {...form.register("durationDays")} aria-invalid={!!errors.durationDays} />
                {msg("durationDays")}
              </div>
              {type === "CLASS_PACK" && (
                <div className="grid gap-2">
                  <Label htmlFor={id("classCredits")}>Number of classes</Label>
                  <Input id={id("classCredits")} type="number" min={1} {...form.register("classCredits")} aria-invalid={!!errors.classCredits} />
                  {msg("classCredits")}
                </div>
              )}
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor={id("description")}>Description</Label>
                <Textarea id={id("description")} rows={2} {...form.register("description")} />
              </div>
            </div>

            <fieldset className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">Freezing</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" {...form.register("allowFreeze")} /> Members may freeze this membership
              </label>
              {allowFreeze && (
                <div className="grid gap-2">
                  <Label htmlFor={id("maxFreezeDays")}>Maximum freeze days per membership</Label>
                  <Input id={id("maxFreezeDays")} type="number" min={1} {...form.register("maxFreezeDays")} aria-invalid={!!errors.maxFreezeDays} />
                  {msg("maxFreezeDays")}
                </div>
              )}
            </fieldset>

            <fieldset className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">Cancellation</legend>
              <div className="grid gap-2">
                <Label htmlFor={id("cancellationNoticeDays")}>Notice period (days)</Label>
                <Input id={id("cancellationNoticeDays")} type="number" min={0} {...form.register("cancellationNoticeDays")} />
                <p className="text-xs text-muted-foreground">0 = access ends the day it is cancelled.</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={id("cancellationFee")}>Cancellation fee ({currency})</Label>
                <Input id={id("cancellationFee")} inputMode="decimal" {...form.register("cancellationFee")} aria-invalid={!!errors.cancellationFee} />
                {msg("cancellationFee")}
              </div>
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" {...form.register("isActive")} /> Available for new sales
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} Save plan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
