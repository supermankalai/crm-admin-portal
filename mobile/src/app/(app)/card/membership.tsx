import { RefreshControl, ScrollView, Text, View } from "react-native";
import { MEMBERSHIP_STATE, StatusChip } from "@/components/status-chip";
import { Banner, Card, EmptyState, FormError, Skeleton } from "@/components/ui";
import { date } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { useMembership } from "@/lib/member-queries";
import type { ResponseOf } from "@fitcrm/shared/api/contract";

type MembershipView = NonNullable<ResponseOf<"memberMembership">["current"]>;

const PLAN_TYPE = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", YEARLY: "Yearly", CLASS_PACK: "Class pack" } as const;

function MembershipCard({ m, emphasise }: { m: MembershipView; emphasise?: boolean }) {
  const state = MEMBERSHIP_STATE[m.state];
  return (
    <Card className="gap-2">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className={`${emphasise ? "text-xl" : "text-base"} font-semibold text-zinc-900 dark:text-zinc-50`}>{m.planName}</Text>
          <Text className="text-sm text-zinc-500 dark:text-zinc-400">{PLAN_TYPE[m.planType]}</Text>
        </View>
        <StatusChip label={state.label} tone={state.tone} />
      </View>
      <Text className="text-base text-zinc-700 dark:text-zinc-300">
        {date(m.startDate)} – {date(m.endDate)}
      </Text>
      {m.state === "active" || m.state === "frozen" ? <Text className="text-base text-zinc-700 dark:text-zinc-300">{m.daysRemaining} days left</Text> : null}
      {m.classCreditsRemaining !== null ? <Text className="text-base text-zinc-700 dark:text-zinc-300">Classes left: {m.classCreditsRemaining}</Text> : null}
      {m.frozen ? (
        <Text className="text-base text-sky-700 dark:text-sky-300">
          {m.state === "frozen" ? "Frozen" : "Freeze planned"}: {date(m.frozen.from)} – {date(m.frozen.to)}
        </Text>
      ) : null}
    </Card>
  );
}

/** Plan, status, dates, freeze, class credits and renewal reminder. */
export default function MembershipScreen() {
  const q = useMembership();
  const d = q.data;
  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4" refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}>
      {q.isPending ? (
        <Card className="gap-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton />
          <Skeleton className="h-5 w-2/3" />
        </Card>
      ) : q.error && !d ? (
        <FormError message={errorMessage(q.error)} />
      ) : d ? (
        <>
          {d.renewal ? (
            <View className="overflow-hidden rounded-2xl">
              <Banner tone="warning" icon="alarm-outline">
                {d.renewal.message}
              </Banner>
            </View>
          ) : null}
          {d.current ? <MembershipCard m={d.current} emphasise /> : <EmptyState icon="card-outline" title="No active membership" description="Ask the front desk about joining or renewing." />}
          {d.upcoming.length ? <Text className="px-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">Coming up</Text> : null}
          {d.upcoming.map((m) => (
            <MembershipCard key={m.id} m={m} />
          ))}
          <Card className="gap-1">
            <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Class booking rules</Text>
            <Text className="text-base text-zinc-600 dark:text-zinc-400">Book up to {d.rules.bookingDaysAhead} days ahead.</Text>
            <Text className="text-base text-zinc-600 dark:text-zinc-400">
              Cancel a booked class up to {d.rules.cancelHoursBefore} hour{d.rules.cancelHoursBefore === 1 ? "" : "s"} before it starts. You can leave a waitlist any time.
            </Text>
          </Card>
          {d.past.length ? <Text className="px-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">History</Text> : null}
          {d.past.map((m) => (
            <MembershipCard key={m.id} m={m} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
