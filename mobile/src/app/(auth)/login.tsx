import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { identifierSchema } from "@fitcrm/shared/api/schemas";
import { Button, FormError, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { deviceInfo } from "@/lib/device";
import { errorMessage } from "@/lib/errors";
import { api, signIn } from "@/lib/session";

// The same identifier rule the server applies; the password is checked by the server only.
const loginFormSchema = z.object({ identifier: identifierSchema, password: z.string().min(1, "Enter your password").max(128) });
type LoginForm = z.infer<typeof loginFormSchema>;

const SIGNED_OUT_MESSAGE: Record<string, string> = {
  revoked: "You were signed out on this device. Please sign in again.",
  expired: "Your session expired. Please sign in again.",
  password_changed: "Your password was changed. Sign in with your new password.",
};

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const { signedOutReason } = useSession();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginForm>({ resolver: zodResolver(loginFormSchema), defaultValues: { identifier: "", password: "" } });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const r = await api.call("login", { body: { ...values, device: deviceInfo() } });
      await signIn(r);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-white dark:bg-zinc-950">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }} contentContainerClassName="gap-6 px-6" keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-brand">
            <Ionicons name="barbell" size={30} color="#fff" />
          </View>
          <Text accessibilityRole="header" className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            Sign in to Kangaroo Gym Pilot
          </Text>
          <Text className="text-base text-zinc-600 dark:text-zinc-400">Gym staff, trainers and members.</Text>
        </View>

        {signedOutReason && SIGNED_OUT_MESSAGE[signedOutReason] ? (
          <View accessibilityRole="alert" className="rounded-xl bg-amber-50 p-3 dark:bg-amber-950">
            <Text className="text-sm text-amber-900 dark:text-amber-200">{SIGNED_OUT_MESSAGE[signedOutReason]}</Text>
          </View>
        ) : null}

        <View className="gap-4">
          <Controller
            control={form.control}
            name="identifier"
            render={({ field, fieldState }) => (
              <TextField
                label="Email or phone number"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                autoCapitalize="none"
                autoComplete="username"
                keyboardType="email-address"
                textContentType="username"
                testID="login-identifier"
              />
            )}
          />
          <Controller
            control={form.control}
            name="password"
            render={({ field, fieldState }) => (
              <TextField
                label="Password"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                secureTextEntry
                secureToggle
                autoComplete="current-password"
                textContentType="password"
                onSubmitEditing={submit}
                testID="login-password"
              />
            )}
          />
          <FormError message={error ?? (online ? null : "You're offline. Connect to the internet to sign in.")} />
          <Button label="Sign in" onPress={submit} loading={form.formState.isSubmitting} disabled={!online} testID="login-submit" />
        </View>

        <View className="gap-1">
          <Button label="Email or text me a code instead" variant="ghost" onPress={() => router.push("/otp")} />
          <Button label="I have an invite from my gym" variant="ghost" onPress={() => router.push("/invite")} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
