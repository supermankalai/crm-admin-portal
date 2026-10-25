import { useDeferredValue, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/screen";
import { StatusChip } from "@/components/status-chip";
import { Button, ChipGroup, EmptyState, FormError, Skeleton, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { date } from "@/lib/format";
import { can, MEMBER_STATUS } from "@/lib/staff";
import { useStaffMembers, type MemberStatus } from "@/lib/staff-queries";

const FILTERS: { value: MemberStatus | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "frozen", label: "Frozen" },
  { value: "none", label: "No plan" },
];

/** Search and filter members; the list loads more as you scroll. */
export default function MembersTab() {
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<MemberStatus | undefined>(undefined);
  const q = useDeferredValue(text.trim());
  const list = useStaffMembers({ q, status });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total;
  const canAdd = can(gym?.permissions, "members.create") && !!gym?.access.writable;

  return (
    <Screen title="Members" scroll={false}>
      <View className="gap-3 pb-3">
        <TextField label="Search members" value={text} onChangeText={setText} placeholder="Name, phone, email or number" autoCorrect={false} returnKeyType="search" />
        <ChipGroup options={FILTERS} value={status} onChange={setStatus} />
        {canAdd ? <Button label="Add member" icon="person-add-outline" onPress={() => router.push("/members/new")} disabled={!online} /> : null}
        {total !== undefined ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">{total === 1 ? "1 member" : `${total} members`}</Text> : null}
      </View>
      {list.isPending ? (
        <View className="gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </View>
      ) : list.error && !list.data ? (
        <FormError message={errorMessage(list.error)} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(m) => m.id}
          contentContainerClassName="gap-2 pb-10"
          onEndReachedThreshold={0.5}
          onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={() => list.refetch()}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No members found" description={q || status ? "Try a different search or filter." : "Add your first member to get started."} />}
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator className="py-4" /> : null}
          renderItem={({ item: m }) => {
            const s = MEMBER_STATUS[m.status];
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${m.name}, member ${m.memberNumber}, ${s.label}${m.planName ? `, ${m.planName}` : ""}`}
                onPress={() => router.push({ pathname: "/members/[memberId]", params: { memberId: m.id } })}
                className="flex-row items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 active:opacity-80 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <View className="flex-1 gap-0.5">
                  <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{m.name}</Text>
                  <Text className="text-sm text-zinc-500 dark:text-zinc-400">
                    #{m.memberNumber}
                    {m.planName ? ` · ${m.planName}` : ""}
                    {m.endDate ? ` · until ${date(m.endDate)}` : ""}
                  </Text>
                </View>
                <StatusChip label={s.label} tone={s.tone} />
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}
