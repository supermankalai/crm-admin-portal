import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { EmptyState, FormError, ListRow, Skeleton } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { errorMessage } from "@/lib/errors";
import { useAssignPlan, useTrainerClients } from "@/lib/fitness-queries";

/** Copy a plan to one of my clients as their active plan. */
export default function AssignPlan() {
  const { planId, title } = useLocalSearchParams<{ planId: string; title: string }>();
  const router = useRouter();
  const online = useOnline();
  const clients = useTrainerClients();
  const assign = useAssignPlan();
  const [chosen, setChosen] = useState<string | null>(null);

  const give = (memberId: string) => {
    setChosen(memberId);
    assign.mutate({ planId, memberId }, { onSuccess: (r) => router.replace({ pathname: "/plans/[planId]", params: { planId: r.planId } }) });
  };

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10">
      <Text className="text-base text-zinc-600 dark:text-zinc-400">“{title}” is copied to the client as their active plan. Later edits to this one won&apos;t change theirs.</Text>
      <FormError message={assign.error ? errorMessage(assign.error) : null} />
      {!online ? <FormError message="You're offline. This needs a connection." /> : null}
      {clients.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !clients.data?.clients.length ? (
        <EmptyState icon="people-outline" title="No clients yet" description="A manager assigns clients to you in the web portal." />
      ) : (
        <View className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {clients.data.clients.map((c) => (
            <ListRow
              key={c.memberId}
              icon="person-outline"
              title={c.name}
              subtitle={assign.isPending && chosen === c.memberId ? "Giving plan…" : (c.activePlan ? `Current plan: ${c.activePlan}` : "No active plan")}
              onPress={online && !assign.isPending ? () => give(c.memberId) : undefined}
              accessibilityHint="Gives this plan to the client"
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
