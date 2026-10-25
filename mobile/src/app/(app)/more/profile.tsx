import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Controller, useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { memberContactSelfSchema, type MemberContactFormValues } from "@fitcrm/shared/validation/members";
import { Banner, Button, Card, EmptyState, FormError, ListRow, Skeleton, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage, fieldErrorsOf } from "@/lib/errors";
import { dateTime } from "@/lib/format";
import { useMemberProfile, useUpdateProfile, type MemberProfile } from "@/lib/inbox-queries";

/** The member's contact details and emergency contact, and the account-deletion option. */
export default function ProfileScreen() {
  const q = useMemberProfile();
  if (q.isPending) {
    return (
      <View className="flex-1 gap-3 bg-zinc-50 p-4 dark:bg-zinc-950">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </View>
    );
  }
  if (!q.data) return <EmptyState icon="person-outline" title="Couldn't load your profile" description={errorMessage(q.error)} />;
  return <ProfileForm profile={q.data} />;
}

function ProfileForm({ profile }: { profile: MemberProfile }) {
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const save = useUpdateProfile();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<MemberContactFormValues, unknown, z.output<typeof memberContactSelfSchema>>({
    resolver: zodResolver(memberContactSelfSchema),
    defaultValues: {
      email: profile.email ?? "",
      phone: profile.phone ?? "",
      address: profile.address ?? "",
      emergencyContact: { name: profile.emergencyContact?.name ?? "", phone: profile.emergencyContact?.phone ?? "", relation: profile.emergencyContact?.relation ?? "" },
    },
  });
  const writable = !!gym?.access.writable;
  const request = profile.deletionRequest;

  const submit = form.handleSubmit(async () => {
    setError(null);
    setSaved(false);
    try {
      await save.mutateAsync(form.getValues());
      setSaved(true);
    } catch (e) {
      for (const [k, v] of Object.entries(fieldErrorsOf(e))) form.setError(k as FieldPath<MemberContactFormValues>, { message: v });
      setError(errorMessage(e));
    }
  });

  const field = (name: FieldPath<MemberContactFormValues>, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field: f, fieldState }) => <TextField label={label} value={(f.value as string) ?? ""} onChangeText={f.onChange} onBlur={f.onBlur} error={fieldState.error?.message} editable={writable} {...extra} />}
    />
  );

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
      <Card className="gap-0.5">
        <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {profile.name}
        </Text>
        <Text className="text-sm text-zinc-500 dark:text-zinc-400">Member {profile.memberNumber} · to change your name, ask at the front desk</Text>
      </Card>

      <Text accessibilityRole="header" className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Contact details
      </Text>
      {field("phone", "Mobile number", { keyboardType: "phone-pad", autoComplete: "tel", hint: "With country code, e.g. +91 98765 43210" })}
      {field("email", "Email", { keyboardType: "email-address", autoCapitalize: "none", autoComplete: "email", hint: "Where the gym sends receipts. Your sign-in stays the same." })}
      {field("address", "Address", { autoComplete: "street-address", multiline: true })}
      <Text accessibilityRole="header" className="px-1 pt-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Emergency contact
      </Text>
      {field("emergencyContact.name", "Name", { autoCapitalize: "words" })}
      {field("emergencyContact.phone", "Phone", { keyboardType: "phone-pad" })}
      {field("emergencyContact.relation", "Relation", { placeholder: "e.g. Spouse" })}
      <FormError message={error} />
      {saved ? (
        <View accessibilityRole="alert" className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950">
          <Text className="text-base text-emerald-900 dark:text-emerald-200">Saved.</Text>
        </View>
      ) : null}
      {!online ? <FormError message="You're offline. Saving needs a connection." /> : null}
      {writable ? <Button label="Save changes" onPress={submit} loading={save.isPending} disabled={!online} /> : null}

      <Text accessibilityRole="header" className="px-1 pt-4 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Your account
      </Text>
      {request?.status === "REQUESTED" ? (
        <View className="overflow-hidden rounded-2xl">
          <Banner tone="info" icon="time-outline">
            You asked for your account to be deleted on {dateTime(request.requestedAt, gym?.timezone ?? "UTC")}. The gym will handle it soon.
          </Banner>
        </View>
      ) : (
        <>
          {request?.status === "REJECTED" ? (
            <View className="overflow-hidden rounded-2xl">
              <Banner tone="warning" icon="alert-circle-outline">
                The gym couldn&apos;t delete your account yet{request.note ? `: ${request.note}` : "."}
              </Banner>
            </View>
          ) : null}
          <Card className="p-0">
            <ListRow icon="trash-outline" title="Delete my account" subtitle="Ask the gym to delete your app account and personal data" destructive onPress={() => router.push("/more/delete-account")} />
          </Card>
        </>
      )}
    </ScrollView>
  );
}
