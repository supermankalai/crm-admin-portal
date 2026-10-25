import { Alert, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/screen";
import { Card, ListRow, Skeleton } from "@/components/ui";
import { useSession } from "@/hooks/use-session";
import { useUnreadCount } from "@/lib/inbox-queries";
import { api, leaveGym, signOut, updateGyms } from "@/lib/session";

export default function MoreScreen() {
  const router = useRouter();
  const { gyms, gym } = useSession();
  const me = useQuery({
    queryKey: ["me"],
    // Name, email and phone: memory only.
    meta: { sensitive: true },
    queryFn: async () => {
      const r = await api.call("me");
      await updateGyms(r.gyms);
      return r;
    },
  });
  const canSwitch = gyms.filter((g) => g.appAccess.allowed).length > 1;
  const unread = useUnreadCount();

  return (
    <Screen title="More" onRefresh={() => me.refetch()}>
      <Card>
        {me.data ? (
          <View className="gap-0.5">
            <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {me.data.user.name}
            </Text>
            {me.data.user.email ? <Text className="text-base text-zinc-600 dark:text-zinc-400">{me.data.user.email}</Text> : null}
            {me.data.user.phone ? <Text className="text-base text-zinc-600 dark:text-zinc-400">{me.data.user.phone}</Text> : null}
          </View>
        ) : (
          <View className="gap-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </View>
        )}
      </Card>

      <Card className="p-0">
        <ListRow
          icon="notifications-outline"
          title="Notifications"
          subtitle={unread ? (unread === 1 ? "1 unread" : `${unread} unread`) : "Reminders, waitlist news and alerts"}
          onPress={() => router.push("/more/notifications")}
        />
        <ListRow icon="megaphone-outline" title="Announcements" subtitle={`News from ${gym?.name ?? "your gym"}`} onPress={() => router.push("/more/announcements")} />
        <ListRow icon="options-outline" title="Alerts on this phone" subtitle="Choose what you're notified about" onPress={() => router.push("/more/notification-settings")} />
      </Card>

      {gym?.role === "MEMBER" ? (
        <Card className="p-0">
          <ListRow icon="person-circle-outline" title="My details" subtitle="Contact details and emergency contact" onPress={() => router.push("/more/profile")} />
          <ListRow icon="card-outline" title="My membership" subtitle="Plan, dates, freeze and credits" onPress={() => router.push("/card/membership")} />
          <ListRow icon="footsteps-outline" title="Attendance" subtitle="Your check-in history" onPress={() => router.push("/more/attendance")} />
          <ListRow icon="wallet-outline" title="Payments & invoices" onPress={() => router.push("/more/payments")} />
        </Card>
      ) : null}

      <Card className="p-0">
        {canSwitch ? (
          <ListRow
            icon="swap-horizontal"
            title="Switch gym"
            subtitle={gym?.name}
            onPress={async () => {
              await leaveGym();
              router.replace("/select-gym");
            }}
          />
        ) : null}
        <ListRow icon="finger-print" title="App lock" subtitle="Face ID or fingerprint" onPress={() => router.push("/more/security")} />
        <ListRow icon="phone-portrait-outline" title="Your devices" subtitle="See and sign out devices" onPress={() => router.push("/more/devices")} />
        <ListRow icon="key-outline" title="Change password" onPress={() => router.push("/more/password")} />
      </Card>

      <Card className="p-0">
        <ListRow
          icon="log-out-outline"
          title="Sign out"
          destructive
          onPress={() =>
            Alert.alert("Sign out?", "Your saved data on this device will be removed.", [
              { text: "Cancel", style: "cancel" },
              { text: "Sign out", style: "destructive", onPress: () => void signOut() },
            ])
          }
        />
      </Card>
    </Screen>
  );
}
