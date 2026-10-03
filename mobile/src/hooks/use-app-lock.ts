import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { secure } from "@/lib/secure";
import { lock } from "@/lib/session";

/**
 * Lock the app (biometrics) when it returns from the background after the chosen time, if the
 * user turned biometric unlock on. Nothing behind the lock is rendered while it's up.
 */
export function useAppLock() {
  const backgroundedAt = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (status) => {
      if (status === "background") {
        backgroundedAt.current = Date.now();
        return;
      }
      if (status === "active" && backgroundedAt.current) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        const prefs = await secure.getPrefs();
        if (prefs.biometrics && away >= prefs.lockAfterMinutes * 60_000) lock();
      }
    });
    return () => sub.remove();
  }, []);
}
