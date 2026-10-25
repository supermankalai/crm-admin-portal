import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { MEASUREMENTS } from "@fitcrm/shared/domain/progress";
import { progressEntrySchema, type ProgressEntryFormValues } from "@fitcrm/shared/validation/fitness";
import { Button, FormError, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage, fieldErrorsOf } from "@/lib/errors";
import { emptyProgressForm } from "@/lib/fitness";
import { useDeleteProgress, useMemberProgress, useSaveProgress } from "@/lib/fitness-queries";
import { localDay } from "@/lib/format";

/** Log (or edit) a day's measurements. Same rules as the server; one entry per day. */
export default function LogProgress() {
  const params = useLocalSearchParams<{ recordedOn?: string; entryId?: string }>();
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const progress = useMemberProgress();
  const save = useSaveProgress();
  const remove = useDeleteProgress();
  const [error, setError] = useState<string | null>(null);
  const [today] = useState(() => localDay(new Date().toISOString(), gym?.timezone ?? "UTC"));
  const existing = params.entryId ? progress.data?.entries.find((e) => e.id === params.entryId) : undefined;
  const defaults: ProgressEntryFormValues = existing
    ? { ...emptyProgressForm(existing.recordedOn), ...Object.fromEntries(Object.entries(existing.values).map(([k, v]) => [k, String(v)])) }
    : emptyProgressForm(params.recordedOn ?? today);
  const form = useForm<ProgressEntryFormValues, unknown, z.output<typeof progressEntrySchema>>({ resolver: zodResolver(progressEntrySchema), defaultValues: defaults });

  const submit = form.handleSubmit(async () => {
    setError(null);
    try {
      await save.mutateAsync(form.getValues());
      router.back();
    } catch (e) {
      for (const [k, v] of Object.entries(fieldErrorsOf(e))) form.setError(k as keyof ProgressEntryFormValues, { message: v });
      setError(errorMessage(e));
    }
  });

  const confirmDelete = () =>
    Alert.alert("Delete this entry?", undefined, [
      { text: "Keep", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(existing!.id, { onSuccess: () => router.back(), onError: (e) => setError(errorMessage(e)) }) },
    ]);

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
      <Text className="text-base text-zinc-600 dark:text-zinc-400">Fill in what you measured — leave the rest empty. Only you and your trainer can see these.</Text>
      <Controller
        control={form.control}
        name="recordedOn"
        render={({ field: f, fieldState }) => <TextField label="Date" value={f.value} onChangeText={f.onChange} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" error={fieldState.error?.message} editable={!existing} />}
      />
      <View className="flex-row flex-wrap gap-3">
        {MEASUREMENTS.map((m) => (
          <View key={m.key} className="w-[47%] grow">
            <Controller
              control={form.control}
              name={m.key}
              render={({ field: f, fieldState }) => <TextField label={`${m.label} (${m.unit})`} value={f.value} onChangeText={f.onChange} keyboardType="decimal-pad" error={fieldState.error?.message} />}
            />
          </View>
        ))}
      </View>
      <FormError message={error} />
      {!online ? <FormError message="You're offline. Saving needs a connection." /> : null}
      <Button label="Save" onPress={submit} loading={save.isPending} disabled={!online} />
      {existing ? <Button label="Delete entry" variant="danger" onPress={confirmDelete} loading={remove.isPending} disabled={!online} /> : null}
    </ScrollView>
  );
}
