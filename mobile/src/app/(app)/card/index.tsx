import { useCallback, useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Brightness from "expo-brightness";
import { usePreventScreenCapture } from "expo-screen-capture";
import QRCode from "react-native-qrcode-svg";
import { Screen } from "@/components/screen";
import { MEMBERSHIP_STATE, StatusChip } from "@/components/status-chip";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { date } from "@/lib/format";
import { useMemberCard } from "@/lib/member-queries";

/** Seconds until an ISO time, ticking once a second. */
function useSecondsLeft(iso: string | undefined) {
  const compute = useCallback(() => (iso ? Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000)) : 0), [iso]);
  const [left, setLeft] = useState(compute);
  useEffect(() => {
    const id = setInterval(() => setLeft(compute()), 1000);
    return () => clearInterval(id);
  }, [compute]);
  return left;
}

/** Brighten the screen while the card is visible so scanners read it easily; restore after. */
function useBrightScreen() {
  useFocusEffect(
    useCallback(() => {
      let previous: number | null = null;
      void (async () => {
        try {
          previous = await Brightness.getBrightnessAsync();
          await Brightness.setBrightnessAsync(1);
        } catch {
          // not available (e.g. some emulators): fine
        }
      })();
      return () => {
        void (async () => {
          try {
            if (Platform.OS === "android") await Brightness.restoreSystemBrightnessAsync();
            else if (previous !== null) await Brightness.setBrightnessAsync(previous);
          } catch {
            // ignore
          }
        })();
      };
    }, [])
  );
}

/**
 * The digital membership card. The QR code is a short-lived signed token (45 s, single use) that
 * refreshes every 30 s — a screenshot stops working within a minute and can't be reused. Screen
 * capture is blocked while the card is open, as an extra guard.
 */
export default function CardScreen() {
  usePreventScreenCapture("member-card");
  useBrightScreen();
  const router = useRouter();
  const online = useOnline();
  const card = useMemberCard();
  const left = useSecondsLeft(card.data?.qr.expiresAt);
  const expired = !card.data || left <= 0;
  const membership = card.data?.membership ?? null;
  const state = membership ? MEMBERSHIP_STATE[membership.state] : null;

  return (
    <Screen title="My card" onRefresh={() => card.refetch()}>
      <Card className="items-center gap-4 py-6">
        {card.isPending ? (
          <Skeleton className="h-64 w-64" />
        ) : expired ? (
          <View className="h-64 w-64 items-center justify-center rounded-2xl bg-zinc-100 p-6 dark:bg-zinc-800">
            <Text className="text-center text-base text-zinc-700 dark:text-zinc-300">
              {online ? "Getting a fresh code…" : "Connect to the internet to show your check-in code. Codes change every 30 seconds, so a saved one won't work."}
            </Text>
          </View>
        ) : (
          <View accessible accessibilityRole="image" accessibilityLabel={`Check-in QR code. Refreshes in ${left} seconds.`} className="rounded-2xl bg-white p-4">
            <QRCode value={card.data!.qr.token} size={240} backgroundColor="#ffffff" color="#000000" ecl="M" />
          </View>
        )}
        {card.data ? (
          <View className="items-center gap-1">
            <Text accessibilityRole="header" className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {card.data.member.name}
            </Text>
            <Text className="font-mono text-base text-zinc-500 dark:text-zinc-400">{card.data.member.memberNumber}</Text>
            {!expired ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">Show this at the front desk · new code in {left}s</Text> : null}
          </View>
        ) : null}
      </Card>

      {card.data && !membership ? (
        <EmptyState icon="card-outline" title="No active membership" description="Ask the front desk about joining or renewing." />
      ) : null}

      {membership && state ? (
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{membership.planName}</Text>
            <StatusChip label={state.label} tone={state.tone} />
          </View>
          <Text className="text-base text-zinc-600 dark:text-zinc-400">
            {membership.state === "frozen" && membership.frozen ? `Frozen until ${date(membership.frozen.to)}` : `Valid until ${date(membership.endDate)}`}
          </Text>
          {membership.classCreditsRemaining !== null ? (
            <Text className="text-base text-zinc-600 dark:text-zinc-400">
              {membership.classCreditsRemaining} class{membership.classCreditsRemaining === 1 ? "" : "es"} left
            </Text>
          ) : null}
          <Button label="Membership details" variant="secondary" onPress={() => router.push("/card/membership")} />
        </Card>
      ) : null}
    </Screen>
  );
}
