import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBrand } from "@/hooks/use-brand";
import { useSession } from "@/hooks/use-session";
import { absoluteUrl } from "@/lib/config";
import { leaveGym } from "@/lib/session";

const ROLE_LABEL = { OWNER: "Owner", MANAGER: "Manager", FRONT_DESK: "Front desk", TRAINER: "Trainer", MEMBER: "Member" } as const;

/** The gym's logo (or a brand-coloured initial), name and role; tap to switch gyms. */
export function GymLogo({ name, logoUrl, brandColor, size = 40 }: { name: string; logoUrl: string | null; brandColor?: string; size?: number }) {
  const { brand, onBrand } = useBrand(brandColor);
  const [failed, setFailed] = useState(false);
  const uri = absoluteUrl(logoUrl);
  if (uri && !failed) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 10 }} contentFit="contain" accessibilityIgnoresInvertColors onError={() => setFailed(true)} cachePolicy="memory" />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: brand }} className="items-center justify-center">
      <Text style={{ color: onBrand, fontSize: size * 0.45, fontWeight: "700" }}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

export function GymHeader({ title }: { title: string }) {
  const { gym, gyms } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (!gym) return null;
  const canSwitch = gyms.filter((g) => g.appAccess.allowed).length > 1;
  return (
    <View style={{ paddingTop: insets.top + 8 }} className="border-b border-zinc-200 bg-white px-4 pb-3 dark:border-zinc-800 dark:bg-zinc-950">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${gym.name}, ${ROLE_LABEL[gym.role]}${canSwitch ? ". Switch gym" : ""}`}
        disabled={!canSwitch}
        onPress={async () => {
          await leaveGym();
          router.replace("/select-gym");
        }}
        className="flex-row items-center gap-3"
      >
        <GymLogo name={gym.name} logoUrl={gym.logoUrl} brandColor={gym.brandColor} size={36} />
        <View className="flex-1">
          <Text numberOfLines={1} className="text-xs text-zinc-500 dark:text-zinc-400">
            {gym.name} · {ROLE_LABEL[gym.role]}
          </Text>
          <Text accessibilityRole="header" numberOfLines={1} className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
            {title}
          </Text>
        </View>
        {canSwitch ? <Ionicons name="swap-horizontal" size={22} color="#71717a" /> : null}
      </Pressable>
    </View>
  );
}
