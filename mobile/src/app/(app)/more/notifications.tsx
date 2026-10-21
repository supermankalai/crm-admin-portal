import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, EmptyState, FormError, Skeleton } from "@/components/ui";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { dateTime } from "@/lib/format";
import { targetRoute, useInbox, useReadAll, useReadNotification, type InboxItem } from "@/lib/inbox-queries";
import { liveHref } from "@/lib/live";

const ICON: Partial<Record<InboxItem["type"], keyof typeof Ionicons.glyphMap>> = {
  CLASS_REMINDER: "alarm-outline",
  WAITLIST_PROMOTED: "checkmark-circle-outline",
  MEMBERSHIP_EXPIRING: "hourglass-outline",
  PAYMENT_DUE: "wallet-outline",
  PAYMENT_OVERDUE: "wallet-outline",
  ANNOUNCEMENT: "megaphone-outline",
  CLASS_FULL: "people-outline",
  LIVE_CLASS_STARTING: "videocam-outline",
  LIVE_PT_STARTING: "videocam-outline",
};

/** Your notifications in this gym. Tapping one marks it read and opens what it's about. */
export default function InboxScreen() {
  const router = useRouter();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useInbox();
  const read = useReadNotification();
  const readAll = useReadAll();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;

  const open = (n: InboxItem) => {
    if (!n.readAt) read.mutate(n.id);
    // An online session about to start: its call.
    if (n.live) return void router.push(liveHref(n.live));
    // Only where this role has a screen (e.g. members have no Alerts tab).
    const route = targetRoute(n.target, gym?.role);
    if (route) router.push(route);
  };

  if (q.isPending) {
    return (
      <View className="flex-1 gap-3 bg-zinc-50 p-4 dark:bg-zinc-950">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </View>
    );
  }
  if (q.error && !q.data) return <FormError message={errorMessage(q.error)} />;

  return (
    <FlatList
      className="flex-1 bg-zinc-50 dark:bg-zinc-950"
      contentContainerClassName="gap-2 p-4 pb-10"
      data={items}
      keyExtractor={(n) => n.id}
      onEndReachedThreshold={0.5}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      refreshing={q.isRefetching && !q.isFetchingNextPage}
      onRefresh={() => q.refetch()}
      ListHeaderComponent={
        unread ? (
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base text-zinc-600 dark:text-zinc-400">{unread === 1 ? "1 unread" : `${unread} unread`}</Text>
            <Button label="Mark all read" variant="ghost" icon="checkmark-done-outline" onPress={() => readAll.mutate()} loading={readAll.isPending} />
          </View>
        ) : null
      }
      ListEmptyComponent={<EmptyState icon="notifications-outline" title="No notifications yet" description="Class reminders, waitlist news, payment reminders and gym announcements will appear here." />}
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator className="py-4" /> : null}
      renderItem={({ item: n }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${n.readAt ? "" : "Unread. "}${n.title}. ${n.body}. ${dateTime(n.createdAt, tz)}`}
          onPress={() => open(n)}
          className={`flex-row gap-3 rounded-2xl border p-4 active:opacity-80 ${n.readAt ? "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" : "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-zinc-900"}`}
        >
          <Ionicons name={ICON[n.type] ?? "notifications-outline"} size={22} color="#71717a" />
          <View className="flex-1 gap-0.5">
            <View className="flex-row items-center gap-2">
              {!n.readAt ? <View accessibilityElementsHidden className="size-2 rounded-full bg-orange-500" /> : null}
              <Text className={`flex-1 text-base text-zinc-900 dark:text-zinc-50 ${n.readAt ? "" : "font-semibold"}`}>{n.title}</Text>
            </View>
            <Text className="text-sm text-zinc-600 dark:text-zinc-300">{n.body}</Text>
            <Text className="text-xs text-zinc-500 dark:text-zinc-400">{dateTime(n.createdAt, tz)}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}
