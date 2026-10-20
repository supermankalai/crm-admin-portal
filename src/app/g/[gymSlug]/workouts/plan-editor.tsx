"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { workoutPlanSchema, type WorkoutPlanFormValues } from "@/lib/validation/fitness";
import { savePlanAction } from "./actions";
import { blankDay, blankExercise } from "./plan-shared";

type Out = z.output<typeof workoutPlanSchema>;
const STATUSES = [
  { value: "ACTIVE", label: "Active", hint: "the client sees it in the app" },
  { value: "DRAFT", label: "Draft", hint: "only staff see it" },
  { value: "ARCHIVED", label: "Archived", hint: "kept for history" },
] as const;


/** Create or edit a plan: days, each with exercises. Same schema as the mobile app and the API. */
export function PlanEditor({ gymSlug, planId, memberId, initial }: { gymSlug: string; planId?: string; memberId?: string | null; initial: WorkoutPlanFormValues }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<WorkoutPlanFormValues, unknown, Out>({ resolver: zodResolver(workoutPlanSchema), defaultValues: initial });
  const days = useFieldArray({ control: form.control, name: "days" });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(
    () =>
      startTransition(async () => {
        const r = await savePlanAction(gymSlug, { ...form.getValues(), planId, memberId: memberId ?? null });
        if (!r.ok) return void toast.error(r.error);
        toast.success("Plan saved.");
        router.push(`/g/${gymSlug}/workouts/${r.data.planId}`);
        router.refresh();
      }),
    () => toast.error("Please check the highlighted fields.")
  );

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="plan-title">Title</Label>
          <Input id="plan-title" maxLength={120} aria-invalid={!!errors.title} aria-describedby="plan-title-error" {...form.register("title")} />
          <p id="plan-title-error" role="alert" className="text-sm text-destructive">
            {errors.title?.message}
          </p>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Status</legend>
          {STATUSES.map((s) => (
            <label key={s.value} className="flex items-center gap-2 text-sm">
              <input type="radio" value={s.value} className="size-4" {...form.register("status")} /> {s.label} <span className="text-muted-foreground">— {s.hint}</span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="plan-notes">Notes for the client (optional)</Label>
          <Textarea id="plan-notes" rows={3} maxLength={2000} {...form.register("notes")} />
        </div>
      </div>

      {days.fields.map((day, i) => (
        <DayFields key={day.id} index={i} control={form.control} register={form.register} errors={errors} onRemove={days.fields.length > 1 ? () => days.remove(i) : undefined} />
      ))}
      <p role="alert" className="text-sm text-destructive">
        {errors.days?.message ?? errors.days?.root?.message}
      </p>

      <div className="flex flex-wrap gap-2">
        {days.fields.length < 14 && (
          <Button type="button" variant="outline" onClick={() => days.append(blankDay(days.fields.length))}>
            <Plus aria-hidden /> Add a day
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />} Save plan
        </Button>
      </div>
    </form>
  );
}

function DayFields({
  index,
  control,
  register,
  errors,
  onRemove,
}: {
  index: number;
  control: Control<WorkoutPlanFormValues, unknown, Out>;
  register: UseFormRegister<WorkoutPlanFormValues>;
  errors: FieldErrors<WorkoutPlanFormValues>;
  onRemove?: () => void;
}) {
  const exercises = useFieldArray({ control, name: `days.${index}.exercises` });
  const dayErrors = errors.days?.[index];
  const id = (f: string) => `day-${index}-${f}`;
  return (
    <fieldset className="grid gap-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-semibold">Day {index + 1}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid flex-1 gap-2">
          <Label htmlFor={id("title")}>Name</Label>
          <Input id={id("title")} maxLength={80} aria-invalid={!!dayErrors?.title} aria-describedby={id("title-error")} {...register(`days.${index}.title`)} />
          <p id={id("title-error")} role="alert" className="text-sm text-destructive">
            {dayErrors?.title?.message}
          </p>
        </div>
        {onRemove && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove day ${index + 1}`}>
            <Trash2 aria-hidden /> Remove day
          </Button>
        )}
      </div>

      {exercises.fields.map((ex, j) => {
        const e = dayErrors?.exercises?.[j];
        const eid = (f: string) => id(`ex-${j}-${f}`);
        const message = e?.name?.message ?? e?.sets?.message ?? e?.reps?.message ?? e?.restSeconds?.message ?? e?.notes?.message;
        return (
          <fieldset key={ex.id} className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
            <legend className="sr-only">Exercise {j + 1}</legend>
            <div className="grid gap-1.5">
              <Label htmlFor={eid("name")}>Exercise {j + 1}</Label>
              <Input id={eid("name")} maxLength={120} aria-invalid={!!e?.name} aria-describedby={eid("error")} {...register(`days.${index}.exercises.${j}.name`)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={eid("sets")}>Sets</Label>
              <Input id={eid("sets")} inputMode="numeric" aria-invalid={!!e?.sets} aria-describedby={eid("error")} {...register(`days.${index}.exercises.${j}.sets`)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={eid("reps")}>Reps</Label>
              <Input id={eid("reps")} maxLength={20} placeholder="8-12" aria-invalid={!!e?.reps} aria-describedby={eid("error")} {...register(`days.${index}.exercises.${j}.reps`)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={eid("rest")}>Rest (s)</Label>
              <Input id={eid("rest")} inputMode="numeric" aria-invalid={!!e?.restSeconds} aria-describedby={eid("error")} {...register(`days.${index}.exercises.${j}.restSeconds`)} />
            </div>
            <div className="flex items-end">
              {exercises.fields.length > 1 && (
                <Button type="button" variant="ghost" size="icon" onClick={() => exercises.remove(j)} aria-label={`Remove exercise ${j + 1}`}>
                  <Trash2 aria-hidden />
                </Button>
              )}
            </div>
            <div className="grid gap-1.5 sm:col-span-5">
              <Label htmlFor={eid("notes")}>Coaching cue (optional)</Label>
              <Input id={eid("notes")} maxLength={500} {...register(`days.${index}.exercises.${j}.notes`)} />
              <p id={eid("error")} role="alert" className="text-sm text-destructive">
                {message}
              </p>
            </div>
          </fieldset>
        );
      })}
      {exercises.fields.length < 30 && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => exercises.append(blankExercise())}>
            <Plus aria-hidden /> Add exercise
          </Button>
        </div>
      )}
    </fieldset>
  );
}
