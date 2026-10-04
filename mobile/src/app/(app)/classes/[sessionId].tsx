import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StatusChip } from "@/components/status-chip";
import { Banner, Button, Card, EmptyState, FormError } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { dateTime, dayLabel, time } from "@/lib/format";
import { useBookClass, useCancelBooking, useMemberClasses } from "@/lib/member-queries";
import { classBadge, spotsText } from "@/lib/classes";

/** One class: details, your status, and Book / Join waitlist / Cancel — all confirmed by the server. */
export default function ClassDetail() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const online = useOnline();
  const q = useMemberClasses();
  const book = useBookClass();
  const cancel = useCancelBooking();
  const [result, setResult] = useState<string | null>(null);
  // When the screen opened (reading the clock during render isn't allowed by the React Compiler).
  const [openedAt] = useState(() => Date.now());
  const c = q.data?.classes.find((x) => x.id === sessionId);

  if (!c) return <EmptyState icon="calendar-outline" title={q.isPending ? "Loading…" : "Class not found"} description={q.isPending ? undefined : "It may have moved outside the booking window."} />;
  const badge = classBadge(c);
  const full = c.spotsLeft === 0;
  const busy = book.isPending || cancel.isPending;
  const error = book.error ?? cancel.error;

  const doBook = () => {
    setResult(null);
    book.mutate(c.id, {
      onSuccess: (r) => setResult(r.status === "BOOKED" ? "You're booked. See you there!" : `The class is full — you're number ${r.waitlistPosition} on the waitlist. We'll move you in if a spot opens.`),
    });
  };
  const doCancel = () => {
    const leaving = c.my?.status === "WAITLISTED";
    Alert.alert(leaving ? "Leave the waitlist?" : "Cancel your booking?", leaving ? undefined : "Your spot goes to the next person on the waitlist.", [
      { text: "Keep it", style: "cancel" },
      {
        text: leaving ? "Leave waitlist" : "Cancel booking",
        style: "destructive",
        onPress: () => {
          setResult(null);
          cancel.mutate(c.my!.bookingId, { onSuccess: (r) => setResult(leaving ? "You've left the waitlist." : r.creditReturned ? "Booking cancelled. Your class credit is back." : "Booking cancelled.") });
        },
      },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4">
      <Card className="gap-2">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1">
            <Text accessibilityRole="header" className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {c.className}
            </Text>
            <Text className="text-base text-zinc-600 dark:text-zinc-400">
              {dayLabel(c.startsAt, tz)} · {time(c.startsAt, tz)}–{time(c.endsAt, tz)}
            </Text>
          </View>
          {badge ? <StatusChip label={badge.label} tone={badge.tone} /> : null}
        </View>
        <Text className="text-base text-zinc-700 dark:text-zinc-300">With {c.trainer}</Text>
        <Text className="text-base text-zinc-700 dark:text-zinc-300">
          {c.room}, {c.location}
        </Text>
        <Text className="text-base text-zinc-700 dark:text-zinc-300">
          {spotsText(c)}
          {c.waitlisted ? ` · ${c.waitlisted} on the waitlist` : ""}
        </Text>
        {c.description ? <Text className="mt-1 text-base text-zinc-600 dark:text-zinc-400">{c.description}</Text> : null}
      </Card>

      {c.status === "CANCELLED" ? (
        <View className="overflow-hidden rounded-2xl">
          <Banner tone="info" icon="close-circle-outline">
            This class was cancelled by the gym.
          </Banner>
        </View>
      ) : null}
      {result ? (
        <View accessibilityRole="alert" className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950">
          <Text className="text-base text-emerald-900 dark:text-emerald-200">{result}</Text>
        </View>
      ) : null}
      <FormError message={error ? errorMessage(error) : null} />
      {!online ? <FormError message="You're offline. Booking and cancelling need a connection." /> : null}

      {c.canBook ? <Button label={full ? "Join the waitlist" : "Book this class"} icon={full ? "time-outline" : "checkmark-circle-outline"} onPress={doBook} loading={book.isPending} disabled={!online || busy} /> : null}
      {c.my && c.canCancel ? <Button label={c.my.status === "WAITLISTED" ? "Leave the waitlist" : "Cancel booking"} variant="danger" onPress={doCancel} loading={cancel.isPending} disabled={!online || busy} /> : null}
      {c.my?.status === "BOOKED" && !c.canCancel && new Date(c.startsAt).getTime() > openedAt ? (
        <Text className="text-center text-sm text-zinc-500 dark:text-zinc-400">Cancellation closed at {dateTime(c.cancelDeadline, tz)}. Please contact the gym if you can&apos;t make it.</Text>
      ) : null}
    </ScrollView>
  );
}
