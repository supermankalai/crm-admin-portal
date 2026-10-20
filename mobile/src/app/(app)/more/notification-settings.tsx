import { useCallback, useState } from "react";
import { Linking, ScrollView, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { PREFERENCE_LABELS, type PreferenceKey } from "@fitcrm/shared/domain/notifications";
import { Banner, Button, Card, FormError, Skeleton } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { errorMessage } from "@/lib/errors";
import { usePreferences, useUpdatePreferences } from "@/lib/inbox-queries";
import { pushAvailable, pushPermission, registerForPush } from "@/lib/push";

/**
 * Which alerts this phone shows for this gym. The switches change what the gym's server sends;
 * the in-app list always keeps everything. Turning alerts on here is the only place we ask the
 * system for notification permission.
 */
export default function NotificationSettings() {
  const online = useOnline();
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const [permission, setPermission] = useState<"granted" | "not-asked" | "denied" | null>(null);
  const [registering, setRegistering] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const available = pushAvailable();

  useFocusEffect(
    useCallback(() => {
      void pushPermission().then(setPermission);
    }, [])
  );

  const turnOn = async () => {
    setRegistering(true);
    setResult(null);
    const status = await registerForPush({ ask: true });
    setRegistering(false);
    setPermission(await pushPermission());
    setResult(status === "registered" ? "Alerts are on for this phone." : status === "denied" ? null : "This phone can't receive alerts right now. The in-app list still works.");
  };

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10">
      {!available ? (
        <View className="overflow-hidden rounded-2xl">
          <Banner tone="info" icon="information-circle-outline">
            Phone alerts need the installed FitCRM app (not Expo Go on Android). Everything still appears under Notifications.
          </Banner>
        </View>
      ) : permission === "denied" ? (
        <Card className="gap-3">
          <Text className="text-base text-zinc-800 dark:text-zinc-200">Notifications are turned off for FitCRM in your phone&apos;s settings.</Text>
          <Button label="Open phone settings" variant="secondary" icon="settings-outline" onPress={() => Linking.openSettings()} />
        </Card>
      ) : permission === "not-asked" ? (
        <Card className="gap-3">
          <Text className="text-base text-zinc-800 dark:text-zinc-200">Get class reminders, waitlist news and announcements on this phone. Alerts never show personal details.</Text>
          <Button label="Turn on alerts" icon="notifications-outline" onPress={turnOn} loading={registering} disabled={!online} />
        </Card>
      ) : null}
      {result ? (
        <View accessibilityRole="alert" className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950">
          <Text className="text-base text-emerald-900 dark:text-emerald-200">{result}</Text>
        </View>
      ) : null}

      <Text accessibilityRole="header" className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Alert me about
      </Text>
      {prefs.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : !prefs.data ? (
        <FormError message={errorMessage(prefs.error)} />
      ) : (
        <View className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {prefs.data.available.map((key: PreferenceKey) => (
            <View key={key} className="min-h-16 flex-row items-center gap-3 px-4 py-3">
              <View className="flex-1">
                <Text className="text-base text-zinc-900 dark:text-zinc-50">{PREFERENCE_LABELS[key].label}</Text>
                <Text className="text-sm text-zinc-500 dark:text-zinc-400">{PREFERENCE_LABELS[key].description}</Text>
              </View>
              <Switch
                accessibilityLabel={PREFERENCE_LABELS[key].label}
                accessibilityHint={PREFERENCE_LABELS[key].description}
                value={prefs.data.preferences[key]}
                onValueChange={(v) => update.mutate({ [key]: v })}
                disabled={!online || update.isPending}
              />
            </View>
          ))}
        </View>
      )}
      <FormError message={update.error ? errorMessage(update.error) : null} />
      <Text className="px-1 text-sm text-zinc-500 dark:text-zinc-400">These settings are for this gym only. Turned-off alerts still appear in your notifications list.</Text>
    </ScrollView>
  );
}
