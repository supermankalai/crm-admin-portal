import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/screen";
import { StatusChip } from "@/components/status-chip";
import { FormError, ListRow, Skeleton } from "@/components/ui";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { date, dayLabel, money, time } from "@/lib/format";
import { useStaffAlerts } from "@/lib/staff-queries";

/** What needs attention: memberships about to end, unpaid invoices, and classes that are full. */
export default function AlertsTab() {
  const router = useRouter();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useStaffAlerts();
  const a = q.data;
  const openMember = (memberId: string) => router.push({ pathname: "/members/[memberId]", params: { memberId } });

  return (
    <Screen title="Alerts" onRefresh={() => q.refetch()}>
      {q.isPending ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)
      ) : !a ? (
        <FormError message={errorMessage(q.error)} />
      ) : (
        <>
          <Section title="Memberships ending in 7 days" count={a.expiring.length} empty="No memberships ending this week.">
            {a.expiring.map((e) => (
              <ListRow key={`${e.memberId}-${e.endDate}`} icon="hourglass-outline" title={e.name} subtitle={`${e.plan} · ends ${date(e.endDate)}`} onPress={() => openMember(e.memberId)} accessibilityHint="Opens the member to renew" />
            ))}
          </Section>
          {a.overdue ? (
            <Section title="Overdue payments" count={a.overdue.length} empty="Nothing overdue.">
              {a.overdue.map((i) => (
                <ListRow
                  key={i.invoiceId}
                  icon="alert-circle-outline"
                  title={i.memberName}
                  subtitle={`${i.number} · ${money(i.outstandingMinor, a.currency)} · due ${date(i.dueDate)}`}
                  right={<StatusChip label="Overdue" tone="red" />}
                  onPress={() => openMember(i.memberId)}
                />
              ))}
            </Section>
          ) : null}
          <Section title="Full classes this week" count={a.fullClasses.length} empty="No full classes.">
            {a.fullClasses.map((c) => (
              <ListRow
                key={c.sessionId}
                icon="people-outline"
                title={c.className}
                subtitle={`${dayLabel(c.startsAt, tz)} ${time(c.startsAt, tz)} · ${c.capacity} booked${c.waitlisted ? ` · ${c.waitlisted} waiting` : ""}`}
                onPress={() => router.push({ pathname: "/classes/[sessionId]", params: { sessionId: c.sessionId } })}
              />
            ))}
          </Section>
        </>
      )}
    </Screen>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between px-1">
        <Text accessibilityRole="header" className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {title}
        </Text>
        <StatusChip label={String(count)} tone={count ? "amber" : "zinc"} />
      </View>
      <View className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {count === 0 ? <Text className="p-4 text-base text-zinc-500 dark:text-zinc-400">{empty}</Text> : children}
      </View>
    </View>
  );
}
