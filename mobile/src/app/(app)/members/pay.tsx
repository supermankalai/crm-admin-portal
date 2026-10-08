import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, recordPaymentSchema } from "@fitcrm/shared/validation/payments";
import { Button, Card, ChipGroup, FormError, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { errorMessage, fieldErrorsOf } from "@/lib/errors";
import { money } from "@/lib/format";
import { minorToInput } from "@/lib/staff";
import { useRecordPayment } from "@/lib/staff-queries";

type Values = z.input<typeof recordPaymentSchema>;
const METHODS = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));

/** Record money received against an open invoice (part payments allowed, never more than is due). */
export default function RecordPayment() {
  const params = useLocalSearchParams<{ memberId: string; invoiceId: string; number: string; due: string; currency: string }>();
  const router = useRouter();
  const online = useOnline();
  const pay = useRecordPayment();
  const [error, setError] = useState<string | null>(null);
  const due = Number(params.due) || 0;
  const form = useForm<Values, unknown, z.output<typeof recordPaymentSchema>>({ resolver: zodResolver(recordPaymentSchema), defaultValues: { invoiceId: params.invoiceId, amount: minorToInput(due), method: "CASH", reference: "" } });
  const method = useWatch({ control: form.control, name: "method" });

  const submit = form.handleSubmit(async () => {
    setError(null);
    try {
      await pay.mutateAsync(form.getValues());
      router.back();
    } catch (e) {
      for (const [k, v] of Object.entries(fieldErrorsOf(e))) form.setError(k as keyof Values, { message: v });
      setError(errorMessage(e));
    }
  });

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
      <Card className="gap-1">
        <Text className="text-sm text-zinc-500 dark:text-zinc-400">Invoice {params.number}</Text>
        <Text className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{money(due, params.currency)} due</Text>
      </Card>
      <Controller
        control={form.control}
        name="amount"
        render={({ field: f, fieldState }) => <TextField label={`Amount received (${params.currency})`} value={f.value} onChangeText={f.onChange} keyboardType="decimal-pad" error={fieldState.error?.message} />}
      />
      <Controller control={form.control} name="method" render={({ field: f }) => <ChipGroup label="Method" options={METHODS} value={f.value} onChange={f.onChange} />} />
      <Controller
        control={form.control}
        name="reference"
        render={({ field: f, fieldState }) => (
          <TextField label={method === "TRANSFER" ? "Transfer / UPI reference" : "Reference (optional)"} value={f.value} onChangeText={f.onChange} autoCapitalize="characters" error={fieldState.error?.message} />
        )}
      />
      <FormError message={error} />
      {!online ? <FormError message="You're offline. Payments need a connection." /> : null}
      <View className="gap-2">
        <Button label="Record payment" icon="cash-outline" onPress={submit} loading={pay.isPending} disabled={!online} />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}
