import { useDeferredValue, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/screen";
import { StatusChip } from "@/components/status-chip";
import { EmptyState, FormError, Skeleton, TextField } from "@/components/ui";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { useTrainerClients } from "@/lib/fitness-queries";
import { dayLabel, time } from "@/lib/format";
import { MEMBER_STATUS } from "@/lib/staff";

/** The trainer's assigned clients, with their plan and next session at a glance. */
export default function ClientsTab() {
  const router = useRouter();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useTrainerClients();
  const [text, setText] = useState("");
  const search = useDeferredValue(text.trim().toLowerCase());
  const clients = (q.data?.clients ?? []).filter((c) => !search || c.name.toLowerCase().includes(search) || c.memberNumber.includes(search));

  return (
    <Screen title="Clients" onRefresh={() => q.refetch()}>
      {(q.data?.clients.length ?? 0) > 6 ? <TextField label="Search clients" value={text} onChangeText={setText} autoCorrect={false} /> : null}
      {q.isPending ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)
      ) : q.error && !q.data ? (
        <FormError message={errorMessage(q.error)} />
      ) : clients.length === 0 ? (
        <EmptyState icon="people-outline" title={search ? "No match" : "No clients yet"} description={search ? undefined : "A manager assigns clients to you in the web portal."} />
      ) : (
        clients.map((c) => {
          const s = MEMBER_STATUS[c.status];
          return (
            <Pressable
              key={c.memberId}
              accessibilityRole="button"
              accessibilityLabel={`${c.name}, ${s.label}${c.activePlan ? `, plan ${c.activePlan}` : ", no active plan"}${c.nextSession ? `, next session ${dayLabel(c.nextSession, tz)} ${time(c.nextSession, tz)}` : ""}`}
              onPress={() => router.push({ pathname: "/clients/[memberId]", params: { memberId: c.memberId } })}
              className="flex-row items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 active:opacity-80 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <View className="flex-1 gap-0.5">
                <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{c.name}</Text>
                <Text className="text-sm text-zinc-500 dark:text-zinc-400">{c.activePlan ?? "No active plan"}</Text>
                {c.nextSession ? (
                  <Text className="text-sm text-zinc-500 dark:text-zinc-400">
                    Next PT: {dayLabel(c.nextSession, tz)} {time(c.nextSession, tz)}
                  </Text>
                ) : null}
              </View>
              <StatusChip label={s.label} tone={s.tone} />
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}
