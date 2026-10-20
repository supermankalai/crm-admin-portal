import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, FormError, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { useRequestDeletion } from "@/lib/inbox-queries";

/** Ask the gym to delete the account. Says plainly what happens, and needs an explicit tick. */
export default function DeleteAccount() {
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const request = useRequestDeletion();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState(false);
  const gymName = gym?.name ?? "your gym";

  if (done) {
    return (
      <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4">
        <View accessibilityRole="alert" className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950">
          <Text className="text-base text-emerald-900 dark:text-emerald-200">Request sent. {gymName} will delete your account and let you know if anything needs sorting out first.</Text>
        </View>
        <Button label="Back to profile" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
      <Text className="text-base text-zinc-800 dark:text-zinc-200">When {gymName} completes your request:</Text>
      <View className="gap-2">
        {[
          "Your app account for this gym is closed and you're signed out.",
          "Your contact details, emergency contact, measurements, progress photos, workouts and notifications are deleted.",
          "Invoices, payments and visit records are kept for the gym's accounts, without your name.",
          "Your membership itself isn't cancelled by this — please speak to the front desk about that.",
        ].map((line) => (
          <View key={line} className="flex-row gap-2">
            <Text className="text-base text-zinc-500">•</Text>
            <Text className="flex-1 text-base text-zinc-700 dark:text-zinc-300">{line}</Text>
          </View>
        ))}
      </View>
      <TextField label="Anything you'd like to tell the gym? (optional)" value={reason} onChangeText={setReason} multiline maxLength={500} />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmed }}
        onPress={() => setConfirmed((c) => !c)}
        className="min-h-12 flex-row items-center gap-3"
      >
        <Ionicons name={confirmed ? "checkbox" : "square-outline"} size={26} color={confirmed ? "#dc2626" : "#71717a"} />
        <Text className="flex-1 text-base text-zinc-800 dark:text-zinc-200">I understand this can&apos;t be undone.</Text>
      </Pressable>
      <FormError message={request.error ? errorMessage(request.error) : null} />
      {!online ? <FormError message="You're offline. Sending the request needs a connection." /> : null}
      <Button label="Ask the gym to delete my account" variant="danger" onPress={() => request.mutate(reason.trim(), { onSuccess: () => setDone(true) })} loading={request.isPending} disabled={!online || !confirmed} />
    </ScrollView>
  );
}
