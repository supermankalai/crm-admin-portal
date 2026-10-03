import { useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { Banner } from "./ui";
import { GymHeader } from "./gym-header";

/**
 * Standard tab screen: gym header, offline / read-only banners, then scrollable content with
 * pull-to-refresh. Offline, the last known data stays on screen with a clear banner.
 */
export function Screen({ title, children, onRefresh, scroll = true }: { title: string; children: ReactNode; onRefresh?: () => Promise<unknown>; scroll?: boolean }) {
  const online = useOnline();
  const { gym, offline } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const isMember = gym?.role === "MEMBER";
  const readOnly = gym && !gym.access.writable;

  const body = scroll ? (
    <ScrollView
      contentContainerClassName="gap-4 p-4 pb-10"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              try {
                await onRefresh();
              } finally {
                setRefreshing(false);
              }
            }}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View className="flex-1 p-4">{children}</View>
  );

  return (
    <View className="flex-1 bg-zinc-50 dark:bg-zinc-950">
      <GymHeader title={title} />
      {!online || offline ? (
        <Banner tone="warning" icon="cloud-offline-outline">
          You&apos;re offline. Showing the last saved data — check-ins, bookings and payments need a connection.
        </Banner>
      ) : null}
      {readOnly ? (
        isMember ? (
          <Banner tone="info" icon="information-circle-outline">
            {gym.name}&apos;s app is paused for now. Your membership details are still here — please contact the gym for anything else.
          </Banner>
        ) : (
          <Banner tone="danger" icon="lock-closed-outline">
            Read-only: this gym&apos;s subscription {gym.access.reason === "suspended" ? "is suspended" : "has ended"}. You can view data but not make changes.
          </Banner>
        )
      ) : null}
      {body}
    </View>
  );
}
