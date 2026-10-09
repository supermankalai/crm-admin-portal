import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusChip } from "@/components/status-chip";
import { Button, Card, EmptyState } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { exerciseLine } from "@/lib/fitness";
import { useTrainerPlan } from "@/lib/fitness-queries";

/** A plan, read-only, with Edit (author or manager) and "Give to a client". */
export default function PlanDetailScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const writable = online && !!gym?.access.writable;
  const q = useTrainerPlan(planId);
  const p = q.data;
  if (!p) return <EmptyState icon="clipboard-outline" title={q.isPending ? "Loading…" : "Plan not found"} description={q.error ? errorMessage(q.error) : undefined} />;

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10">
      <Card className="gap-2">
        <View className="flex-row items-start justify-between gap-2">
          <Text accessibilityRole="header" className="flex-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {p.title}
          </Text>
          <StatusChip label={p.status === "ACTIVE" ? "Active" : p.status === "DRAFT" ? "Draft" : "Archived"} tone={p.status === "ACTIVE" ? "green" : "zinc"} />
        </View>
        <Text className="text-base text-zinc-500 dark:text-zinc-400">{p.member ? `For ${p.member.name}` : "Template"} · by {p.trainer}</Text>
        {p.notes ? <Text className="text-base text-zinc-700 dark:text-zinc-300">{p.notes}</Text> : null}
      </Card>
      <View className="flex-row gap-2">
        {p.canEdit ? (
          <View className="flex-1">
            <Button label="Edit" icon="create-outline" onPress={() => router.push({ pathname: "/plans/edit", params: { planId: p.id } })} disabled={!writable} />
          </View>
        ) : null}
        <View className="flex-1">
          <Button label="Give to a client" variant="secondary" icon="person-add-outline" onPress={() => router.push({ pathname: "/plans/assign", params: { planId: p.id, title: p.title } })} disabled={!writable} />
        </View>
      </View>
      {p.days.map((d) => (
        <Card key={d.id} className="gap-2">
          <Text className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{d.title}</Text>
          {d.exercises.map((e, i) => (
            <View key={e.id} accessible className="flex-row gap-3">
              <Text className="w-6 text-base text-zinc-400">{i + 1}.</Text>
              <View className="flex-1">
                <Text className="text-base text-zinc-900 dark:text-zinc-50">{e.name}</Text>
                {exerciseLine(e) ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">{exerciseLine(e)}</Text> : null}
                {e.notes ? <Text className="text-sm italic text-zinc-500 dark:text-zinc-400">{e.notes}</Text> : null}
              </View>
            </View>
          ))}
        </Card>
      ))}
    </ScrollView>
  );
}
