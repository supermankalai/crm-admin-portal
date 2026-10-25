import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as ScreenCapture from "expo-screen-capture";
import { secure, type Prefs } from "@/lib/secure";
import { lock } from "@/lib/session";

/** iOS: blur the app-switcher snapshot natively whenever the app lock is on. */
export async function applyAppSwitcherProtection(prefs: Prefs) {
  if (Platform.OS !== "ios") return;
  await (prefs.biometrics ? ScreenCapture.enableAppSwitcherProtectionAsync(60) : ScreenCapture.disableAppSwitcherProtectionAsync()).catch(() => undefined);
}

/**
 * The app lock. If biometric unlock is on:
 *   - while the app isn't in the foreground, a privacy cover hides it, so the app switcher's
 *     snapshot shows nothing personal;
 *   - coming back after the chosen time locks it. The decision uses preferences already in memory,
 *     so no screen flashes up before the lock.
 * While locked, the root layout renders only the lock screen: nothing behind it is mounted.
 * Returns whether the privacy cover should show.
 */
export function useAppLock() {
  const backgroundedAt = useRef<number | null>(null);
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    void secure.getPrefs().then(applyAppSwitcherProtection);
    const sub = AppState.addEventListener("change", (status) => {
      const prefs = secure.prefsNow();
      if (status === "inactive" || status === "background") {
        if (status === "background") backgroundedAt.current ??= Date.now();
        if (prefs.biometrics) setCovered(true);
        return;
      }
      if (status === "active") {
        const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0;
        backgroundedAt.current = null;
        if (prefs.biometrics && away >= prefs.lockAfterMinutes * 60_000) lock();
        setCovered(false);
      }
    });
    return () => sub.remove();
  }, []);
  return covered;
}
