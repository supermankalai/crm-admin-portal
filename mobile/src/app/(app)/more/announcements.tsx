import { FlatList, Text, View } from "react-native";
import { EmptyState, FormError, Skeleton } from "@/components/ui";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { dateTime } from "@/lib/format";
import { useAnnouncements } from "@/lib/inbox-queries";

/** News from the gym. Members see announcements for members and everyone; staff see all. */
export default function AnnouncementsScreen() {
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useAnnouncements();

  if (q.isPending) {
    return (
      <View className="flex-1 gap-3 bg-zinc-50 p-4 dark:bg-zinc-950">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </View>
    );
  }
  if (!q.data) return <FormError message={errorMessage(q.error)} />;

  return (
    <FlatList
      className="flex-1 bg-zinc-50 dark:bg-zinc-950"
      contentContainerClassName="gap-3 p-4 pb-10"
      data={q.data.items}
      keyExtractor={(a) => a.id}
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}
      ListEmptyComponent={<EmptyState icon="megaphone-outline" title="No announcements" description={`News from ${gym?.name ?? "your gym"} will appear here.`} />}
      renderItem={({ item: a }) => (
        <View accessible className="gap-1 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {a.title}
          </Text>
          <Text className="text-xs text-zinc-500 dark:text-zinc-400">
            {dateTime(a.publishedAt, tz)}
            {gym?.role !== "MEMBER" && a.audience === "STAFF" ? " · Staff only" : ""}
          </Text>
          <Text className="mt-1 text-base text-zinc-700 dark:text-zinc-300">{a.body}</Text>
        </View>
      )}
    />
  );
}
