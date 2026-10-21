import { useMemo } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/screen";
import { StatusChip } from "@/components/status-chip";
import { EmptyState, FormError, Skeleton } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { hasStarted, PT_STATUS, scheduleSubtitle, scheduleTitle } from "@/lib/fitness";
import { JoinLiveButton } from "@/components/live-join";
import { useTrainerSchedule, useUpdateSession, type ScheduleItem } from "@/lib/fitness-queries";
import { dayLabel, localDay, time } from "@/lib/format";

/** The trainer's next 7 days: classes they teach, personal training sessions and shifts. */
export default function ScheduleTab() {
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useTrainerSchedule();
  const update = useUpdateSession();

  const days = useMemo(() => {
    const groups = new Map<string, ScheduleItem[]>();
    for (const item of q.data?.items ?? []) {
      const key = localDay(item.startsAt, tz);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [q.data, tz]);

  const openPt = (item: Extract<ScheduleItem, { kind: "pt" }>) => {
    const close = (status: "COMPLETED" | "NO_SHOW" | "CANCELLED") => update.mutate({ id: item.id, status });
    const started = hasStarted(item.startsAt);
    Alert.alert(`PT with ${item.member.name}`, `${dayLabel(item.startsAt, tz)} · ${time(item.startsAt, tz)}${item.focus ? `\n${item.focus}` : ""}`, [
      { text: "Open client", onPress: () => router.push({ pathname: "/clients/[memberId]", params: { memberId: item.member.id } }) },
      ...(item.status === "SCHEDULED" && online
        ? [
            ...(started ? [{ text: "Mark done", onPress: () => close("COMPLETED") }, { text: "Mark no-show", onPress: () => close("NO_SHOW") }] : []),
            { text: "Cancel session", style: "destructive" as const, onPress: () => close("CANCELLED") },
          ]
        : []),
      { text: "Close", style: "cancel" },
    ]);
  };

  return (
    <Screen title="Schedule" onRefresh={() => q.refetch()}>
      <FormError message={update.error ? errorMessage(update.error) : null} />
      {q.isPending ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)
      ) : q.error && !q.data ? (
        <FormError message={errorMessage(q.error)} />
      ) : days.length === 0 ? (
        <EmptyState icon="calendar-outline" title="Nothing scheduled this week" description="Your classes, PT sessions and shifts for the next 7 days appear here." />
      ) : (
        days.map(([day, items]) => (
          <View key={day} className="gap-2">
            <Text accessibilityRole="header" className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {dayLabel(items[0].startsAt, tz)}
            </Text>
            {items.map((item) => {
              const pt = item.kind === "pt" ? PT_STATUS[item.status as keyof typeof PT_STATUS] : null;
              const onPress =
                item.kind === "class" ? () => router.push({ pathname: "/classes/[sessionId]", params: { sessionId: item.id } }) : item.kind === "pt" ? () => openPt(item) : undefined;
              const live = item.kind !== "shift" && item.status === "SCHEDULED" ? item : null;
              return (
                <View key={`${item.kind}-${item.id}`} className="gap-2">
                <Pressable
                  accessibilityRole={onPress ? "button" : "text"}
                  accessibilityLabel={`${time(item.startsAt, tz)} to ${time(item.endsAt, tz)}, ${scheduleTitle(item)}. ${scheduleSubtitle(item)}`}
                  onPress={onPress}
                  disabled={!onPress}
                  className={`flex-row items-center gap-3 rounded-2xl border p-4 ${item.kind === "shift" ? "border-dashed border-zinc-300 dark:border-zinc-700" : "border-zinc-200 bg-white active:opacity-80 dark:border-zinc-800 dark:bg-zinc-900"}`}
                >
                  <View className="w-16">
                    <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{time(item.startsAt, tz)}</Text>
                    <Text className="text-xs text-zinc-500 dark:text-zinc-400">{time(item.endsAt, tz)}</Text>
                  </View>
                  <View style={{ backgroundColor: item.kind === "class" ? item.color : item.kind === "pt" ? "#71717a" : "transparent" }} className="h-10 w-1 rounded-full" />
                  <View className="flex-1 gap-0.5">
                    <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{scheduleTitle(item)}</Text>
                    <Text className="text-sm text-zinc-500 dark:text-zinc-400">{scheduleSubtitle(item)}</Text>
                  </View>
                  {pt && item.kind === "pt" && item.status !== "SCHEDULED" ? <StatusChip label={pt.label} tone={pt.tone} /> : null}
                </Pressable>
                {live ? <JoinLiveButton link={{ kind: live.kind, sessionId: live.id }} mode={live.deliveryMode} startsAt={live.startsAt} endsAt={live.endsAt} timeZone={tz} label={live.kind === "class" ? "Host the online class" : "Join the online session"} /> : null}
                </View>
              );
            })}
          </View>
        ))
      )}
    </Screen>
  );
}
