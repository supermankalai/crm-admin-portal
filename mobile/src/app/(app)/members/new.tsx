import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { useRouter } from "expo-router";
import { Controller, useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { memberSchema } from "@fitcrm/shared/validation/members";
import { Button, FormError, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage, fieldErrorsOf } from "@/lib/errors";
import { can } from "@/lib/staff";
import { useCreateMember } from "@/lib/staff-queries";

type Values = z.input<typeof memberSchema>;

/** Quick sign-up at the desk. Same validation as the web form; health notes stay on the web. */
export default function NewMember() {
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const create = useCreateMember();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values, unknown, z.output<typeof memberSchema>>({
    resolver: zodResolver(memberSchema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", address: "", dateOfBirth: "", healthNotes: "", emergencyContact: { name: "", phone: "", relation: "" } },
  });
  const canSell = can(gym?.permissions, "payments.record");

  const save = (then: "profile" | "sell") =>
    form.handleSubmit(async () => {
      setError(null);
      try {
        // Validated here for instant feedback; the server parses the same schema again.
        const r = await create.mutateAsync(form.getValues());
        router.replace(then === "sell" ? { pathname: "/members/sell", params: { memberId: r.memberId } } : { pathname: "/members/[memberId]", params: { memberId: r.memberId } });
      } catch (e) {
        for (const [k, v] of Object.entries(fieldErrorsOf(e))) form.setError(k as FieldPath<Values>, { message: v });
        setError(errorMessage(e));
      }
    })();

  const field = (name: FieldPath<Values>, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field: f, fieldState }) => <TextField label={label} value={(f.value as string) ?? ""} onChangeText={f.onChange} onBlur={f.onBlur} error={fieldState.error?.message} {...extra} />}
    />
  );

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
      {field("firstName", "First name", { autoComplete: "given-name", autoCapitalize: "words" })}
      {field("lastName", "Last name", { autoComplete: "family-name", autoCapitalize: "words" })}
      {field("phone", "Phone (optional)", { keyboardType: "phone-pad", autoComplete: "tel", hint: "With country code, e.g. +91 98765 43210" })}
      {field("email", "Email (optional)", { keyboardType: "email-address", autoCapitalize: "none", autoComplete: "email" })}
      {field("dateOfBirth", "Date of birth (optional)", { placeholder: "YYYY-MM-DD", keyboardType: "numbers-and-punctuation" })}
      <Text accessibilityRole="header" className="pt-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Emergency contact (optional)
      </Text>
      {field("emergencyContact.name", "Name", { autoCapitalize: "words" })}
      {field("emergencyContact.phone", "Phone", { keyboardType: "phone-pad" })}
      {field("emergencyContact.relation", "Relation", { placeholder: "e.g. Spouse" })}
      <FormError message={error} />
      {!online ? <FormError message="You're offline. Adding a member needs a connection." /> : null}
      {canSell ? <Button label="Save and sell membership" icon="card-outline" onPress={() => save("sell")} loading={create.isPending} disabled={!online} /> : null}
      <Button label="Save member" variant={canSell ? "secondary" : "primary"} onPress={() => save("profile")} loading={create.isPending} disabled={!online} />
    </ScrollView>
  );
}
