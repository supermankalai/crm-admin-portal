import { Redirect, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { useSession } from "@/hooks/use-session";

/** Invite links (https://…/app/invite/<token> or fitcrm://app/invite/<token>) open here. */
export default function InviteLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { phase } = useSession();
  if (phase === "signedOut") return <Redirect href={{ pathname: "/invite", params: { token } }} />;
  return (
    <View className="flex-1 items-center justify-center bg-white p-8 dark:bg-zinc-950">
      <Text className="text-center text-base text-zinc-700 dark:text-zinc-300">
        You&apos;re signed in. To accept this invitation, sign out first (More → Sign out), then open the link again.
      </Text>
    </View>
  );
}
