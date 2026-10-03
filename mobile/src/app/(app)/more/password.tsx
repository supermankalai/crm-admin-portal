import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { changePasswordSchema } from "@fitcrm/shared/validation/auth";
import { Button, FormError, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { errorMessage, fieldErrorsOf } from "@/lib/errors";
import { api, signOutLocal } from "@/lib/session";

type Values = z.input<typeof changePasswordSchema>;

/** Same rules as the web: current password required; afterwards every device is signed out. */
export default function PasswordScreen() {
  const online = useOnline();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.call("changePassword", { body: values });
      await signOutLocal("password_changed");
    } catch (e) {
      for (const [k, v] of Object.entries(fieldErrorsOf(e))) form.setError(k as keyof Values, { message: v });
      setError(errorMessage(e));
    }
  });

  const field = (name: keyof Values, label: string, hint?: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field: f, fieldState }) => (
        <TextField label={label} value={f.value} onChangeText={f.onChange} error={fieldState.error?.message} secureTextEntry secureToggle hint={hint} autoComplete={name === "currentPassword" ? "current-password" : "new-password"} />
      )}
    />
  );

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
      <Text className="text-base text-zinc-600 dark:text-zinc-400">After changing it you will be signed out on every device, including this one.</Text>
      {field("currentPassword", "Current password")}
      {field("newPassword", "New password", "At least 10 characters with upper and lower case letters and a number.")}
      {field("confirmPassword", "Confirm new password")}
      <FormError message={error} />
      <Button label="Change password" onPress={submit} loading={form.formState.isSubmitting} disabled={!online} />
    </ScrollView>
  );
}
