import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Controller, useFieldArray, useForm, type Control, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { workoutPlanSchema, type WorkoutPlanFormValues } from "@fitcrm/shared/validation/fitness";
import { Button, Card, ChipGroup, EmptyState, FormError, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { errorMessage, fieldErrorsOf } from "@/lib/errors";
import { blankDay, blankExercise, blankPlan, planToForm } from "@/lib/fitness";
import { useSavePlan, useTrainerPlan } from "@/lib/fitness-queries";

const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "DRAFT", label: "Draft" },
  { value: "ARCHIVED", label: "Archived" },
] as const;

/** Create a plan (for a client, or a template) or edit one. Same validation as the server. */
export default function EditPlan() {
  const { planId, memberId, memberName } = useLocalSearchParams<{ planId?: string; memberId?: string; memberName?: string }>();
  const existing = useTrainerPlan(planId);
  if (planId && !existing.data) return <EmptyState icon="clipboard-outline" title={existing.isPending ? "Loading…" : "Plan not found"} description={existing.error ? errorMessage(existing.error) : undefined} />;
  return <PlanForm planId={planId} memberId={memberId ?? null} heading={existing.data ? (existing.data.member ? `For ${existing.data.member.name}` : "Template") : memberName ? `For ${memberName}` : "Template — give it to clients later"} initial={existing.data ? planToForm(existing.data) : blankPlan()} />;
}

type Out = z.output<typeof workoutPlanSchema>;

function PlanForm({ planId, memberId, heading, initial }: { planId?: string; memberId: string | null; heading: string; initial: WorkoutPlanFormValues }) {
  const router = useRouter();
  const online = useOnline();
  const save = useSavePlan();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<WorkoutPlanFormValues, unknown, Out>({ resolver: zodResolver(workoutPlanSchema), defaultValues: initial });
  const days = useFieldArray({ control: form.control, name: "days" });

  const submit = form.handleSubmit(async () => {
    setError(null);
    try {
      const r = await save.mutateAsync({ planId, body: form.getValues(), memberId });
      router.replace({ pathname: "/plans/[planId]", params: { planId: r.planId } });
    } catch (e) {
      for (const [k, v] of Object.entries(fieldErrorsOf(e))) form.setError(k as FieldPath<WorkoutPlanFormValues>, { message: v });
      setError(errorMessage(e));
    }
  }, () => setError("Please check the highlighted fields."));

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-16" keyboardShouldPersistTaps="handled">
      <Text className="text-base text-zinc-600 dark:text-zinc-400">{heading}</Text>
      <Field control={form.control} name="title" label="Title" placeholder="e.g. Strength block" />
      <Field control={form.control} name="notes" label="Notes for the client (optional)" multiline />
      <Controller control={form.control} name="status" render={({ field: f }) => <ChipGroup label="Status" options={STATUSES} value={f.value} onChange={f.onChange} />} />
      <Text className="text-sm text-zinc-500 dark:text-zinc-400">Clients only see Active plans.</Text>
      {form.formState.errors.days?.root?.message || form.formState.errors.days?.message ? <FormError message={form.formState.errors.days?.root?.message ?? form.formState.errors.days?.message} /> : null}

      {days.fields.map((day, i) => (
        <DayEditor key={day.id} control={form.control} index={i} canRemove={days.fields.length > 1} onRemove={() => days.remove(i)} />
      ))}
      {days.fields.length < 14 ? <Button label="Add a day" variant="secondary" icon="add-outline" onPress={() => days.append(blankDay(days.fields.length))} /> : null}

      <FormError message={error} />
      {!online ? <FormError message="You're offline. Saving needs a connection." /> : null}
      <Button label="Save plan" onPress={submit} loading={save.isPending} disabled={!online} />
    </ScrollView>
  );
}

function DayEditor({ control, index, canRemove, onRemove }: { control: Control<WorkoutPlanFormValues, unknown, Out>; index: number; canRemove: boolean; onRemove: () => void }) {
  const exercises = useFieldArray({ control, name: `days.${index}.exercises` });
  return (
    <Card className="gap-3">
      <Field control={control} name={`days.${index}.title`} label={`Day ${index + 1} name`} />
      {exercises.fields.map((ex, j) => (
        <View key={ex.id} className="gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <Field control={control} name={`days.${index}.exercises.${j}.name`} label={`Exercise ${j + 1}`} placeholder="e.g. Back squat" />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Field control={control} name={`days.${index}.exercises.${j}.sets`} label="Sets" keyboardType="number-pad" />
            </View>
            <View className="flex-1">
              <Field control={control} name={`days.${index}.exercises.${j}.reps`} label="Reps" placeholder="8-12" />
            </View>
            <View className="flex-1">
              <Field control={control} name={`days.${index}.exercises.${j}.restSeconds`} label="Rest (s)" keyboardType="number-pad" />
            </View>
          </View>
          <Field control={control} name={`days.${index}.exercises.${j}.notes`} label="Coaching cue (optional)" />
          {exercises.fields.length > 1 ? <Button label="Remove exercise" variant="ghost" icon="trash-outline" onPress={() => exercises.remove(j)} /> : null}
        </View>
      ))}
      {exercises.fields.length < 30 ? <Button label="Add exercise" variant="secondary" icon="add-outline" onPress={() => exercises.append(blankExercise())} /> : null}
      {canRemove ? <Button label="Remove this day" variant="ghost" icon="trash-outline" onPress={onRemove} /> : null}
    </Card>
  );
}

function Field({ control, name, label, ...rest }: { control: Control<WorkoutPlanFormValues, unknown, Out>; name: FieldPath<WorkoutPlanFormValues>; label: string } & Omit<React.ComponentProps<typeof TextField>, "label" | "value" | "onChangeText">) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: f, fieldState }) => <TextField label={label} value={(f.value as string) ?? ""} onChangeText={f.onChange} onBlur={f.onBlur} error={fieldState.error?.message} {...rest} />}
    />
  );
}
