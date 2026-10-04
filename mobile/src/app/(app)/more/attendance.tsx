import { ActivityIndicator, FlatList, RefreshControl, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { EmptyState, FormError, Skeleton } from "@/components/ui";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { dateTime } from "@/lib/format";
import { useAttendance } from "@/lib/member-queries";

/** Your check-ins, newest first (loads more as you scroll). */
export default function AttendanceScreen() {
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useAttendance();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  if (q.isPending)
    return (
      <View className="flex-1 gap-3 bg-zinc-50 p-4 dark:bg-zinc-950">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </View>
    );

  return (
    <FlatList
      className="flex-1 bg-zinc-50 dark:bg-zinc-950"
      contentContainerClassName="gap-2 p-4"
      data={items}
      keyExtractor={(i) => i.id}
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={q.error ? <FormError message={errorMessage(q.error)} /> : null}
      ListEmptyComponent={<EmptyState icon="footsteps-outline" title="No visits yet" description="Your check-ins at the gym will appear here." />}
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator className="py-4" /> : null}
      renderItem={({ item }) => (
        <View accessible accessibilityLabel={`${item.allowed ? "Checked in" : "Not let in"}, ${dateTime(item.checkedInAt, tz)}, ${item.location}${item.reason ? `, ${item.reason}` : ""}`} className="flex-row items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <Ionicons name={item.allowed ? "checkmark-circle" : "close-circle"} size={24} color={item.allowed ? "#059669" : "#dc2626"} />
          <View className="flex-1">
            <Text className="text-base text-zinc-900 dark:text-zinc-50">{dateTime(item.checkedInAt, tz)}</Text>
            <Text className="text-sm text-zinc-500 dark:text-zinc-400">
              {item.location}
              {item.reason ? ` · ${item.reason}` : ""}
            </Text>
          </View>
        </View>
      )}
    />
  );
}
