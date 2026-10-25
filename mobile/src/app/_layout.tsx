import "../global.css";
import { useEffect } from "react";
import { Text, View, useColorScheme } from "react-native";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Application from "expo-application";
import { LockScreen } from "@/components/lock-screen";
import { useAppLock } from "@/hooks/use-app-lock";
import { useSession } from "@/hooks/use-session";
import { apiConfig } from "@/lib/config";
import { clearAllCaches, connectQueryToDevice, forgetGym, persister, queryClient, shouldPersist } from "@/lib/query";
import { secure } from "@/lib/secure";
import { configurePushHandling, dismissDeliveredAlerts } from "@/lib/push";
import { bootstrap, session } from "@/lib/session";

void SplashScreen.preventAutoHideAsync();
configurePushHandling();

// Wipe caches on sign-out/revocation; drop a gym's cached data when leaving it.
session.onReset(clearAllCaches);
// Notifications already delivered belong to the person signing out.
session.onReset(dismissDeliveredAlerts);
session.onLeaveGym(forgetGym);

export default function RootLayout() {
  const scheme = useColorScheme();
  const s = useSession();
  const covered = useAppLock();

  useEffect(() => connectQueryToDevice(), []);
  useEffect(() => {
    void (async () => {
      const prefs = await secure.getPrefs();
      await bootstrap({ lockOnStart: prefs.biometrics });
    })();
  }, []);
  useEffect(() => {
    if (s.phase !== "booting") void SplashScreen.hideAsync();
  }, [s.phase]);

  if (!apiConfig.ok) {
    return (
      <View className="flex-1 items-center justify-center bg-white p-8 dark:bg-zinc-950">
        <Text accessibilityRole="header" className="mb-2 text-xl font-bold text-zinc-900 dark:text-zinc-50">
          App not configured
        </Text>
        <Text className="text-center text-base text-zinc-600 dark:text-zinc-400">{apiConfig.error}</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 24 * 60 * 60_000,
          buster: Application.nativeApplicationVersion ?? "dev",
          dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
        }}
      >
        <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
          <StatusBar style="auto" />
          {s.phase === "booting" ? (
            <View className="flex-1 bg-white dark:bg-zinc-950" />
          ) : s.locked ? (
            // Nothing behind the lock is mounted: no screens, modals, queries or token refresh.
            <LockScreen />
          ) : (
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Protected guard={s.phase === "signedOut"}>
                <Stack.Screen name="(auth)" />
              </Stack.Protected>
              <Stack.Protected guard={s.phase === "signedIn" && !s.gym}>
                <Stack.Screen name="select-gym" />
              </Stack.Protected>
              <Stack.Protected guard={s.phase === "signedIn" && !!s.gym}>
                <Stack.Screen name="(app)" />
              </Stack.Protected>
              <Stack.Screen name="app/invite/[token]" />
            </Stack>
          )}
          {covered && !s.locked ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="absolute inset-0 bg-white dark:bg-zinc-950" /> : null}
        </ThemeProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
