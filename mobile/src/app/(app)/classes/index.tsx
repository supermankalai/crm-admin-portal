import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/screen";
import { StatusChip } from "@/components/status-chip";
import { Card, EmptyState, FormError, Skeleton } from "@/components/ui";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { dayLabel, localDay, time } from "@/lib/format";
import { useMemberClasses } from "@/lib/member-queries";
import { classBadge, spotsText, type MemberClass } from "@/lib/classes";
import { bookingText } from "@/lib/staff";
import { useStaffClasses, type StaffClass } from "@/lib/staff-queries";

function groupByDay<T extends { startsAt: string }>(items: T[], tz: string) {
  const groups = new Map<string, T[]>();
  for (const c of items) {
    const key = localDay(c.startsAt, tz);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()];
}

function MemberClasses() {
  const router = useRouter();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useMemberClasses();

  const days = useMemo(() => groupByDay<MemberClass>(q.data?.classes ?? [], tz), [q.data, tz]);

  return (
    <Screen title="Classes" onRefresh={() => q.refetch()}>
      {q.data ? (
        <Text className="px-1 text-sm text-zinc-500 dark:text-zinc-400">
          Book up to {q.data.rules.bookingDaysAhead} days ahead · cancel until {q.data.rules.cancelHoursBefore}h before
        </Text>
      ) : null}
      {q.isPending ? (
        [0, 1, 2].map((i) => (
          <Card key={i} className="gap-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-6 w-2/3" />
          </Card>
        ))
      ) : q.error && !q.data ? (
        <FormError message={errorMessage(q.error)} />
      ) : days.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No classes scheduled" description="Check back soon — new classes appear here as the gym schedules them." />
      ) : (
        days.map(([day, classes]) => (
          <View key={day} className="gap-2">
            <Text accessibilityRole="header" className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {dayLabel(classes[0].startsAt, tz)}
            </Text>
            {classes.map((c) => {
              const badge = classBadge(c);
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.className}, ${time(c.startsAt, tz)}, with ${c.trainer}. ${badge?.label ?? spotsText(c)}`}
                  onPress={() => router.push({ pathname: "/classes/[sessionId]", params: { sessionId: c.id } })}
                  className="flex-row items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 active:opacity-80 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <View className="w-16">
                    <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{time(c.startsAt, tz)}</Text>
                    <Text className="text-xs text-zinc-500 dark:text-zinc-400">{Math.round((new Date(c.endsAt).getTime() - new Date(c.startsAt).getTime()) / 60000)} min</Text>
                  </View>
                  <View style={{ backgroundColor: c.classColor }} className="h-10 w-1 rounded-full" />
                  <View className="flex-1 gap-0.5">
                    <Text className={`text-base font-semibold text-zinc-900 dark:text-zinc-50 ${c.status === "CANCELLED" ? "line-through" : ""}`}>{c.className}</Text>
                    <Text className="text-sm text-zinc-500 dark:text-zinc-400">
                      {c.trainer} · {c.room}
                    </Text>
                    {!badge ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">{spotsText(c)}</Text> : null}
                  </View>
                  {badge ? <StatusChip label={badge.label} tone={badge.tone} /> : null}
                </Pressable>
              );
            })}
          </View>
        ))
      )}
    </Screen>
  );
}

/** Staff: this week's classes with booking numbers (trainers see their own). */
function StaffClasses() {
  const router = useRouter();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useStaffClasses();
  const days = useMemo(() => groupByDay<StaffClass>(q.data?.classes ?? [], tz), [q.data, tz]);

  return (
    <Screen title="Classes" onRefresh={() => q.refetch()}>
      {gym?.role === "TRAINER" ? <Text className="px-1 text-sm text-zinc-500 dark:text-zinc-400">Your classes for the next 7 days</Text> : <Text className="px-1 text-sm text-zinc-500 dark:text-zinc-400">Next 7 days</Text>}
      {q.isPending ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)
      ) : q.error && !q.data ? (
        <FormError message={errorMessage(q.error)} />
      ) : days.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No classes this week" description="Classes scheduled in the web portal appear here." />
      ) : (
        days.map(([day, classes]) => (
          <View key={day} className="gap-2">
            <Text accessibilityRole="header" className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {dayLabel(classes[0].startsAt, tz)}
            </Text>
            {classes.map((c) => {
              const full = c.booked >= c.capacity;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.className}, ${time(c.startsAt, tz)}, with ${c.trainer}. ${bookingText(c)}${c.status === "CANCELLED" ? ", cancelled" : full ? ", full" : ""}`}
                  onPress={() => router.push({ pathname: "/classes/[sessionId]", params: { sessionId: c.id } })}
                  className="flex-row items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 active:opacity-80 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <Text className="w-16 text-base font-semibold text-zinc-900 dark:text-zinc-50">{time(c.startsAt, tz)}</Text>
                  <View style={{ backgroundColor: c.classColor }} className="h-10 w-1 rounded-full" />
                  <View className="flex-1 gap-0.5">
                    <Text className={`text-base font-semibold text-zinc-900 dark:text-zinc-50 ${c.status === "CANCELLED" ? "line-through" : ""}`}>{c.className}</Text>
                    <Text className="text-sm text-zinc-500 dark:text-zinc-400">
                      {c.trainer} · {c.room}
                    </Text>
                    <Text className="text-sm text-zinc-500 dark:text-zinc-400">{bookingText(c)}</Text>
                  </View>
                  {c.status === "CANCELLED" ? <StatusChip label="Cancelled" tone="zinc" /> : full ? <StatusChip label="Full" tone="amber" /> : null}
                </Pressable>
              );
            })}
          </View>
        ))
      )}
    </Screen>
  );
}

/** Members browse and book; staff see the overview with booking numbers. */
export default function ClassesTab() {
  const { gym } = useSession();
  return gym?.role === "MEMBER" ? <MemberClasses /> : <StaffClasses />;
}
