"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { planUpdateSchema, type PlanUpdateInput } from "@/lib/validation/platform";
import { updatePlanAction } from "../actions";

export function PlanForm({ plan, gymCount }: { plan: PlanUpdateInput; gymCount: number }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof planUpdateSchema>, unknown, PlanUpdateInput>({ resolver: zodResolver(planUpdateSchema), defaultValues: plan });
  const errors = form.formState.errors;
  const id = (field: string) => `${plan.code}-${field}`;

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await updatePlanAction(values);
      if (result.ok) {
        toast.success(`${values.name} plan saved.`);
        form.reset(values);
      } else toast.error(result.error);
    })
  );

  const numberField = (field: "priceMonthlyMinor" | "maxMembers" | "maxStaff" | "maxLocations", label: string, hint?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id(field)}>{label}</Label>
      <Input id={id(field)} type="number" min={field === "priceMonthlyMinor" ? 0 : 1} aria-invalid={!!errors[field]} {...form.register(field, { valueAsNumber: true })} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors[field] && <p className="text-sm text-destructive">{errors[field]?.message}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={id("name")}>Name</Label>
          <Input id={id("name")} {...form.register("name")} aria-invalid={!!errors.name} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("description")}>Description</Label>
          <Input id={id("description")} {...form.register("description")} />
        </div>
        {numberField("priceMonthlyMinor", "Price per month (paise)", "e.g. 199900 = ₹1,999.00")}
        {numberField("maxMembers", "Maximum members")}
        {numberField("maxStaff", "Maximum staff accounts")}
        {numberField("maxLocations", "Maximum locations")}
      </div>
      <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
        <legend className="mb-2 text-sm font-medium">Features</legend>
        {(
          [
            ["featureClassBookings", "Class bookings"],
            ["featureReports", "Reports"],
            ["featureCsvExport", "CSV export"],
            ["isActive", "Offered to new gyms"],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" {...form.register(field)} />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {gymCount} gym{gymCount === 1 ? "" : "s"} on this plan. Lower limits apply to new records only — existing data is kept.
        </p>
        <Button type="submit" disabled={pending || !form.formState.isDirty}>
          {pending && <Loader2 className="animate-spin" aria-hidden />} Save
        </Button>
      </div>
    </form>
  );
}
