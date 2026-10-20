import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ResponseOf } from "@fitcrm/shared/api/contract";
import { inviteTokenSchema } from "@fitcrm/shared/api/schemas";
import { newPasswordSchema } from "@fitcrm/shared/validation/auth";
import { Button, Card, FormError, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { deviceInfo } from "@/lib/device";
import { errorMessage, fieldErrorsOf } from "@/lib/errors";
import { api, signIn } from "@/lib/session";

type Invite = ResponseOf<"inviteLookup">;

const tokenFormSchema = z.object({ token: inviteTokenSchema });
const newAccountSchema = z
  .object({ name: z.string().trim().min(2, "Enter your name").max(80), password: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });
const existingSchema = z.object({ password: z.string().min(1, "Enter your password").max(128) });

const STATE_TEXT = {
  expired: "This invite has expired. Ask your gym for a new one.",
  used: "This invite has already been used. Sign in instead.",
  revoked: "This invite was withdrawn. Ask your gym for a new one.",
} as const;

/** Accept a member app invite: a link from email/SMS, or a code from the front desk. */
export default function InviteScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const online = useOnline();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [token, setToken] = useState<string>(params.token ?? "");
  const [error, setError] = useState<string | null>(null);
  // Front-desk codes making a new account: confirm the invited email/phone first.
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | undefined>();
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const tokenForm = useForm<z.infer<typeof tokenFormSchema>>({ resolver: zodResolver(tokenFormSchema), defaultValues: { token: params.token ?? "" } });
  const newForm = useForm<z.infer<typeof newAccountSchema>>({ resolver: zodResolver(newAccountSchema), defaultValues: { name: "", password: "", confirm: "" } });
  const existingForm = useForm<z.infer<typeof existingSchema>>({ resolver: zodResolver(existingSchema), defaultValues: { password: "" } });

  const lookup = tokenForm.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await api.call("inviteLookup", { body: { token: v.token } });
      setToken(v.token);
      setInvite(r);
      newForm.setValue("name", r.firstName);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  const sendCode = async () => {
    setError(null);
    setSending(true);
    try {
      const r = await api.call("inviteSendCode", { body: { token } });
      setCodeSentTo(r.destination);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const redeem = async (password: string, name?: string) => {
    setError(null);
    setCodeError(undefined);
    try {
      const verificationCode = invite?.needsVerification ? code.trim() : undefined;
      await signIn(await api.call("inviteRedeem", { body: { token, password, name, verificationCode, device: deviceInfo() } }));
    } catch (e) {
      const fields = fieldErrorsOf(e);
      if (fields.password) newForm.setError("password", { message: fields.password });
      if (fields.verificationCode) setCodeError(fields.verificationCode);
      setError(errorMessage(e));
    }
  };

  return (
    <ScrollView className="flex-1 bg-white dark:bg-zinc-950" contentContainerClassName="gap-5 p-6" keyboardShouldPersistTaps="handled">
      {!invite ? (
        <>
          <Text className="text-base text-zinc-600 dark:text-zinc-400">Enter the code from the front desk (like WELC-OME2), or open the link your gym sent you.</Text>
          <Controller
            control={tokenForm.control}
            name="token"
            render={({ field, fieldState }) => <TextField label="Invite code" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} autoCapitalize="characters" autoCorrect={false} />}
          />
          <FormError message={error} />
          <Button label="Continue" onPress={lookup} loading={tokenForm.formState.isSubmitting} disabled={!online} />
        </>
      ) : invite.state !== "valid" ? (
        <>
          <FormError message={STATE_TEXT[invite.state]} />
          <Button label="Try another code" variant="secondary" onPress={() => setInvite(null)} />
        </>
      ) : (
        <>
          <Card>
            <Text className="text-sm text-zinc-500 dark:text-zinc-400">Joining</Text>
            <Text accessibilityRole="header" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              {invite.gym.name}
            </Text>
            <Text className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Invited: {invite.destination}</Text>
          </Card>
          {invite.hasAccount ? (
            <>
              <Text className="text-base text-zinc-600 dark:text-zinc-400">You already have a Kangaroo Gym Pilot account. Enter its password to connect this membership.</Text>
              <Controller
                control={existingForm.control}
                name="password"
                render={({ field, fieldState }) => <TextField label="Your password" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} secureTextEntry secureToggle autoComplete="current-password" />}
              />
              <FormError message={error} />
              <Button label="Connect membership" onPress={existingForm.handleSubmit((v) => redeem(v.password))} loading={existingForm.formState.isSubmitting} disabled={!online} />
            </>
          ) : (
            <>
              <Controller control={newForm.control} name="name" render={({ field, fieldState }) => <TextField label="Your name" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} autoComplete="name" />} />
              <Controller
                control={newForm.control}
                name="password"
                render={({ field, fieldState }) => (
                  <TextField label="Choose a password" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} secureTextEntry secureToggle autoComplete="new-password" hint="At least 10 characters with upper and lower case letters and a number." />
                )}
              />
              <Controller control={newForm.control} name="confirm" render={({ field, fieldState }) => <TextField label="Confirm password" value={field.value} onChangeText={field.onChange} error={fieldState.error?.message} secureTextEntry autoComplete="new-password" />} />
              {invite.needsVerification ? (
                <Card className="gap-3">
                  <Text className="text-base text-zinc-700 dark:text-zinc-300">To make sure it&apos;s you, we&apos;ll send a 6-digit code to {invite.destination}.</Text>
                  <Button label={codeSentTo ? "Send a new code" : "Send code"} variant="secondary" icon="mail-outline" onPress={sendCode} loading={sending} disabled={!online} />
                  {codeSentTo ? <Text accessibilityRole="alert" className="text-sm text-zinc-600 dark:text-zinc-400">Code sent to {codeSentTo}.</Text> : null}
                  <TextField label="Code" value={code} onChangeText={setCode} error={codeError} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
                </Card>
              ) : null}
              <FormError message={error} />
              <Button label="Create account" onPress={newForm.handleSubmit((v) => redeem(v.password, v.name))} loading={newForm.formState.isSubmitting} disabled={!online || (invite.needsVerification && code.trim().length !== 6)} />
            </>
          )}
        </>
      )}
      <View />
    </ScrollView>
  );
}
