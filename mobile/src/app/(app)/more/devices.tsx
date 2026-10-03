import { Alert, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, EmptyState, FormError, ListRow, Skeleton } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { errorMessage } from "@/lib/errors";
import { api } from "@/lib/session";

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Signed-in devices; sign any of them out (its tokens stop working immediately). */
export default function DevicesScreen() {
  const online = useOnline();
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["me", "devices"], queryFn: () => api.call("devices") });
  const revoke = useMutation({
    mutationFn: (deviceId: string) => api.call("revokeDevice", { params: { deviceId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me", "devices"] }),
  });
  const problem = devices.error ?? revoke.error;

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4">
      <FormError message={problem ? errorMessage(problem) : null} />
      <Card className="p-0">
        {devices.isPending ? (
          <View className="gap-2 p-4">
            <Skeleton />
            <Skeleton className="h-5 w-2/3" />
          </View>
        ) : devices.data?.devices.length ? (
          devices.data.devices.map((d) => (
            <ListRow
              key={d.id}
              icon={d.platform === "ios" ? "logo-apple" : d.platform === "android" ? "logo-android" : "globe-outline"}
              title={`${d.name}${d.current ? " (this device)" : ""}`}
              subtitle={`Last used ${dateFmt.format(new Date(d.lastSeenAt))}`}
              accessibilityHint="Signs this device out"
              onPress={
                d.current || !online
                  ? undefined
                  : () =>
                      Alert.alert(`Sign out ${d.name}?`, "That device will need to sign in again.", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Sign out", style: "destructive", onPress: () => revoke.mutate(d.id) },
                      ])
              }
            />
          ))
        ) : (
          <EmptyState icon="phone-portrait-outline" title="No devices" />
        )}
      </Card>
      {!online ? <FormError message="You're offline. Connect to manage your devices." /> : null}
      <Text className="px-1 text-sm text-zinc-500 dark:text-zinc-400">To sign out this device, use Sign out on the previous screen.</Text>
    </ScrollView>
  );
}
