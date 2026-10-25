import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/screen";
import { StatusChip } from "@/components/status-chip";
import { Button, Card, FormError, Skeleton } from "@/components/ui";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { date, money, time } from "@/lib/format";
import { bookingText, can } from "@/lib/staff";
import { useStaffDashboard } from "@/lib/staff-queries";

/** Today at a glance for owners and managers. Money shows only for roles allowed to see it. */
export default function DashboardTab() {
  const router = useRouter();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useStaffDashboard();
  const d = q.data;

  return (
    <Screen title="Dashboard" onRefresh={() => q.refetch()}>
      {can(gym?.permissions, "checkin.perform") ? <Button label="Check in a member" icon="scan-outline" onPress={() => router.push("/checkin")} /> : null}
      {q.isPending ? (
        <View className="flex-row flex-wrap gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-[47%]" />
          ))}
        </View>
      ) : !d ? (
        <FormError message={errorMessage(q.error)} />
      ) : (
        <>
          <View className="flex-row flex-wrap gap-3">
            <Stat label="Check-ins today" value={String(d.checkInsToday)} />
            <Stat label="Active members" value={String(d.activeMembers)} sub={d.newThisMonth ? `+${d.newThisMonth} this month` : undefined} />
            {d.revenue ? <Stat label="Revenue today" value={money(d.revenue.todayMinor, d.currency)} /> : null}
            {d.revenue ? <Stat label="Revenue this month" value={money(d.revenue.monthMinor, d.currency)} /> : null}
            <Stat label="Expiring in 7 days" value={String(d.expiring.length)} onPress={() => router.push("/alerts")} />
            {d.overdue ? <Stat label="Overdue payments" value={String(d.overdue.count)} sub={d.overdue.count ? `${money(d.overdue.totalMinor, d.currency)} due` : undefined} onPress={() => router.push("/alerts")} /> : null}
          </View>

          <Text accessibilityRole="header" className="px-1 pt-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Today&apos;s classes
          </Text>
          {d.todaysClasses.length === 0 ? (
            <Card>
              <Text className="text-base text-zinc-500 dark:text-zinc-400">No classes today.</Text>
            </Card>
          ) : (
            d.todaysClasses.map((c) => {
              const full = c.booked >= c.capacity;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.className} at ${time(c.startsAt, tz)} with ${c.trainer}, ${bookingText(c)}${c.status === "CANCELLED" ? ", cancelled" : ""}`}
                  onPress={() => router.push({ pathname: "/classes/[sessionId]", params: { sessionId: c.id } })}
                  className="flex-row items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 active:opacity-80 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <Text className="w-16 text-base font-semibold text-zinc-900 dark:text-zinc-50">{time(c.startsAt, tz)}</Text>
                  <View style={{ backgroundColor: c.classColor }} className="h-10 w-1 rounded-full" />
                  <View className="flex-1">
                    <Text className={`text-base font-semibold text-zinc-900 dark:text-zinc-50 ${c.status === "CANCELLED" ? "line-through" : ""}`}>{c.className}</Text>
                    <Text className="text-sm text-zinc-500 dark:text-zinc-400">
                      {c.trainer} · {bookingText(c)}
                    </Text>
                  </View>
                  {c.status === "CANCELLED" ? <StatusChip label="Cancelled" tone="zinc" /> : full ? <StatusChip label="Full" tone="amber" /> : null}
                </Pressable>
              );
            })
          )}

          {d.expiring.length ? (
            <>
              <Text accessibilityRole="header" className="px-1 pt-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Expiring soon
              </Text>
              {d.expiring.slice(0, 5).map((e) => (
                <Pressable
                  key={`${e.memberId}-${e.endDate}`}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: "/members/[memberId]", params: { memberId: e.memberId } })}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 active:opacity-80 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{e.name}</Text>
                  <Text className="text-sm text-zinc-500 dark:text-zinc-400">
                    {e.plan} · ends {date(e.endDate)}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value, sub, onPress }: { label: string; value: string; sub?: string; onPress?: () => void }) {
  const body = (
    <>
      <Text className="text-sm text-zinc-500 dark:text-zinc-400">{label}</Text>
      <Text adjustsFontSizeToFit numberOfLines={1} className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        {value}
      </Text>
      {sub ? <Text className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</Text> : null}
    </>
  );
  const cls = "w-[47%] grow gap-1 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ""}`} onPress={onPress} className={`${cls} active:opacity-80`}>
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ""}`} className={cls}>
      {body}
    </View>
  );
}
