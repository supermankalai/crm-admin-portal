import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { DeliveryMode } from "@fitcrm/shared/domain/live";
import { Button } from "@/components/ui";
import { useNow } from "@/hooks/use-now";
import { time } from "@/lib/format";
import { liveHref, liveState, type LiveLink } from "@/lib/live";

/**
 * The way into an online class or PT session: "Join" while the call is open, when it opens before
 * that, nothing for in-person sessions or once it's over. Only shown to people who may join (the
 * screen decides that); the server checks again.
 */
export function JoinLiveButton({ link, mode, startsAt, endsAt, timeZone, label = "Join online" }: { link: LiveLink; mode: DeliveryMode; startsAt: string; endsAt: string; timeZone: string; label?: string }) {
  const router = useRouter();
  const now = useNow();
  const { state, opensAt } = liveState(mode, startsAt, endsAt, now);
  if (state === "none" || state === "ended") return null;
  if (state === "early") {
    return (
      <View className="flex-row items-center gap-1">
        <Text className="text-sm text-zinc-500 dark:text-zinc-400">Online · you can join from {time(opensAt.toISOString(), timeZone)}</Text>
      </View>
    );
  }
  return <Button label={label} icon="videocam-outline" onPress={() => router.push(liveHref(link))} accessibilityHint="Opens the video call" testID={`join-${link.kind}-${link.sessionId}`} />;
}
