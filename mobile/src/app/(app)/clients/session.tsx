import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, ChipGroup, FormError, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage, fieldErrorsOf } from "@/lib/errors";
import { localToIso } from "@/lib/fitness";
import { useCreateSession } from "@/lib/fitness-queries";
import { localDay } from "@/lib/format";

const DURATIONS = [
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1½ hours" },
] as const;

/** Book a personal training session. The server refuses clashes with your classes or sessions. */
export default function BookSession() {
  const { memberId, name } = useLocalSearchParams<{ memberId: string; name: string }>();
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const create = useCreateSession();
  const [day, setDay] = useState(() => localDay(new Date(Date.now() + 86_400_000).toISOString(), tz));
  const [at, setAt] = useState("07:00");
  const [minutes, setMinutes] = useState<(typeof DURATIONS)[number]["value"]>("60");
  const [focus, setFocus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [whenError, setWhenError] = useState<string | undefined>();

  const submit = async () => {
    setError(null);
    setWhenError(undefined);
    const startsAt = localToIso(day, at, tz);
    if (!startsAt) return setWhenError("Enter a date like 2026-10-09 and a time like 07:30.");
    try {
      await create.mutateAsync({ memberId, startsAt, durationMinutes: Number(minutes), focus });
      router.back();
    } catch (e) {
      setWhenError(fieldErrorsOf(e).startsAt);
      setError(errorMessage(e));
    }
  };

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
      <Text className="text-base text-zinc-600 dark:text-zinc-400">With {name}. Times are in the gym&apos;s time zone.</Text>
      <TextField label="Date" value={day} onChangeText={setDay} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" error={whenError} />
      <TextField label="Start time" value={at} onChangeText={setAt} placeholder="07:30" keyboardType="numbers-and-punctuation" />
      <ChipGroup label="Length" options={DURATIONS} value={minutes} onChange={setMinutes} />
      <TextField label="Focus (optional)" value={focus} onChangeText={setFocus} placeholder="e.g. Squat technique" maxLength={120} />
      <FormError message={error} />
      {!online ? <FormError message="You're offline. Booking needs a connection." /> : null}
      <Button label="Book session" icon="calendar-outline" onPress={submit} loading={create.isPending} disabled={!online} />
    </ScrollView>
  );
}
