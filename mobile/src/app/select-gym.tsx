import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GymLogo } from "@/components/gym-header";
import { Button, EmptyState, FormError } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { api, selectGym, signOut, updateGyms, type GymSummary } from "@/lib/session";

const ROLE_LABEL = { OWNER: "Owner", MANAGER: "Manager", FRONT_DESK: "Front desk", TRAINER: "Trainer", MEMBER: "Member" } as const;

/** Pick which gym to use — a person can be staff in one gym and a member in another. */
export default function SelectGymScreen() {
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const { user, gyms, gymNotice } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(gymNotice);

  // Refresh the list (roles, plans and logos may have changed); the cached list shows meanwhile.
  useQuery({
    queryKey: ["me"],
    // Name, email and phone: memory only.
    meta: { sensitive: true },
    queryFn: async () => {
      const me = await api.call("me");
      await updateGyms(me.gyms);
      return me;
    },
  });

  const choose = async (g: GymSummary) => {
    setError(null);
    setBusy(g.slug);
    try {
      await selectGym(g.slug);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }} contentContainerClassName="gap-4 px-5">
      <View className="gap-1">
        <Text accessibilityRole="header" className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          {user ? `Hi ${user.name.split(" ")[0]}` : "Choose a gym"}
        </Text>
        <Text className="text-base text-zinc-600 dark:text-zinc-400">Choose the gym you want to use.</Text>
      </View>
      <FormError message={error} />
      {gyms.length === 0 ? (
        <EmptyState icon="business-outline" title="No gyms yet" description="Your account isn't connected to any gym. Ask your gym for an invite." />
      ) : (
        gyms.map((g) => {
          const disabled = !g.appAccess.allowed || !online;
          return (
            <Pressable
              key={g.slug}
              accessibilityRole="button"
              accessibilityLabel={`${g.name}, ${ROLE_LABEL[g.role]}${g.appAccess.allowed ? "" : ". Not available in the app on this gym's plan"}`}
              accessibilityState={{ disabled, busy: busy === g.slug }}
              disabled={disabled || !!busy}
              onPress={() => choose(g)}
              className={`flex-row items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${disabled ? "opacity-60" : "active:opacity-80"}`}
            >
              <GymLogo name={g.name} logoUrl={g.logoUrl} brandColor={g.brandColor} size={48} />
              <View className="flex-1">
                <Text className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{g.name}</Text>
                <Text className="text-sm text-zinc-500 dark:text-zinc-400">{ROLE_LABEL[g.role]}</Text>
                {!g.appAccess.allowed ? <Text className="mt-1 text-sm text-amber-700 dark:text-amber-400">This gym&apos;s plan doesn&apos;t include the app yet.</Text> : null}
              </View>
              <Ionicons name={busy === g.slug ? "hourglass-outline" : "chevron-forward"} size={20} color="#a1a1aa" />
            </Pressable>
          );
        })
      )}
      {!online ? <FormError message="You're offline. Connect to the internet to open a gym." /> : null}
      <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
    </ScrollView>
  );
}
