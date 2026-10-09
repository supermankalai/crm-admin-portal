import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/screen";
import { StatusChip } from "@/components/status-chip";
import { Button, EmptyState, FormError, ListRow, Skeleton } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { useTrainerPlans } from "@/lib/fitness-queries";
import { dayLabel } from "@/lib/format";

const STATUS = { ACTIVE: { label: "Active", tone: "green" }, DRAFT: { label: "Draft", tone: "zinc" }, ARCHIVED: { label: "Archived", tone: "zinc" } } as const;

/** Templates and clients' plans. Templates are copied to a client when given to them. */
export default function PlansTab() {
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useTrainerPlans();
  const plans = q.data?.plans ?? [];
  const templates = plans.filter((p) => !p.member);
  const clientPlans = plans.filter((p) => p.member);

  const list = (rows: typeof plans, empty: string) => (
    <View className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {rows.length === 0 ? (
        <Text className="p-4 text-base text-zinc-500 dark:text-zinc-400">{empty}</Text>
      ) : (
        rows.map((p) => (
          <ListRow
            key={p.id}
            title={p.title}
            subtitle={`${p.member ? `${p.member.name} · ` : ""}${p.dayCount} ${p.dayCount === 1 ? "day" : "days"} · updated ${dayLabel(p.updatedAt, tz)}`}
            right={<StatusChip label={STATUS[p.status].label} tone={STATUS[p.status].tone} />}
            onPress={() => router.push({ pathname: "/plans/[planId]", params: { planId: p.id } })}
          />
        ))
      )}
    </View>
  );

  return (
    <Screen title="Plans" onRefresh={() => q.refetch()}>
      <Button label="New template" icon="add-circle-outline" onPress={() => router.push("/plans/edit")} disabled={!online || !gym?.access.writable} />
      {q.isPending ? (
        [0, 1].map((i) => <Skeleton key={i} className="h-24 w-full" />)
      ) : q.error && !q.data ? (
        <FormError message={errorMessage(q.error)} />
      ) : plans.length === 0 ? (
        <EmptyState icon="clipboard-outline" title="No plans yet" description="Write a template once and give it to any client, or write a plan from a client's page." />
      ) : (
        <>
          <Text accessibilityRole="header" className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Clients&apos; plans
          </Text>
          {list(clientPlans, "None yet — give a template to a client, or start from their page.")}
          <Text accessibilityRole="header" className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Templates
          </Text>
          {list(templates, "No templates yet.")}
        </>
      )}
    </Screen>
  );
}
