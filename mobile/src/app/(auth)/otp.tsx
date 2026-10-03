import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { identifierSchema } from "@fitcrm/shared/api/schemas";
import { Button, FormError, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { deviceInfo } from "@/lib/device";
import { errorMessage } from "@/lib/errors";
import { api, signIn } from "@/lib/session";

const requestSchema = z.object({ identifier: identifierSchema });
const verifySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") });

/** Sign in with a one-time code sent by email or SMS (5 minutes, single use). */
export default function OtpScreen() {
  const online = useOnline();
  const [identifier, setIdentifier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestForm = useForm<z.infer<typeof requestSchema>>({ resolver: zodResolver(requestSchema), defaultValues: { identifier: "" } });
  const verifyForm = useForm<z.infer<typeof verifySchema>>({ resolver: zodResolver(verifySchema), defaultValues: { code: "" } });

  const request = requestForm.handleSubmit(async ({ identifier: id }) => {
    setError(null);
    try {
      await api.call("otpRequest", { body: { identifier: id } });
      setIdentifier(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  const verify = verifyForm.handleSubmit(async ({ code }) => {
    if (!identifier) return;
    setError(null);
    try {
      await signIn(await api.call("otpVerify", { body: { identifier, code, device: deviceInfo() } }));
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <ScrollView className="flex-1 bg-white dark:bg-zinc-950" contentContainerClassName="gap-5 p-6" keyboardShouldPersistTaps="handled">
      {!identifier ? (
        <>
          <Text className="text-base text-zinc-600 dark:text-zinc-400">Enter the email address or mobile number on your account. If it matches, we&apos;ll send you a 6-digit code.</Text>
          <Controller
            control={requestForm.control}
            name="identifier"
            render={({ field, fieldState }) => (
              <TextField label="Email or phone number" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} autoCapitalize="none" keyboardType="email-address" autoComplete="username" />
            )}
          />
          <FormError message={error} />
          <Button label="Send code" onPress={request} loading={requestForm.formState.isSubmitting} disabled={!online} />
        </>
      ) : (
        <>
          <Text className="text-base text-zinc-600 dark:text-zinc-400">If {identifier} has an account, a code is on its way. It expires in 5 minutes.</Text>
          <Controller
            control={verifyForm.control}
            name="code"
            render={({ field, fieldState }) => (
              <TextField label="6-digit code" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
            )}
          />
          <FormError message={error} />
          <Button label="Sign in" onPress={verify} loading={verifyForm.formState.isSubmitting} disabled={!online} />
          <Button label="Use a different email or number" variant="ghost" onPress={() => setIdentifier(null)} />
        </>
      )}
      <View />
    </ScrollView>
  );
}
