import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { authenticate, biometricSupport } from "@/lib/biometrics";
import { signOut, unlocked } from "@/lib/session";
import { Button } from "./ui";

/** Full-screen biometric lock. Rendered instead of the app: nothing is mounted behind it. */
export function LockScreen() {
  const [label, setLabel] = useState("Biometrics");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const tryUnlock = useCallback(async () => {
    setBusy(true);
    const ok = await authenticate("Unlock FitCRM");
    setBusy(false);
    if (ok) await unlocked();
    else setFailed(true);
  }, []);

  // Prompt straight away when the lock appears.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const support = await biometricSupport();
      if (cancelled) return;
      setLabel(support.label);
      const ok = await authenticate("Unlock FitCRM");
      if (cancelled) return;
      if (ok) await unlocked();
      else setFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View accessibilityViewIsModal className="flex-1 items-center justify-center gap-6 bg-white px-8 dark:bg-zinc-950">
      <Ionicons name="lock-closed" size={48} color="#71717a" />
      <Text accessibilityRole="header" className="text-center text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        FitCRM is locked
      </Text>
      <Text className="text-center text-base text-zinc-600 dark:text-zinc-400">{failed ? `${label} didn't work. Try again, or sign out and sign in with your password.` : `Use ${label} to continue.`}</Text>
      <View className="w-full gap-3">
        <Button label={`Unlock with ${label}`} icon="finger-print" onPress={tryUnlock} loading={busy} />
        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </View>
    </View>
  );
}
