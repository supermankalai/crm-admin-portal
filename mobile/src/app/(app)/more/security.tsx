import { useEffect, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { Card, FormError, ListRow } from "@/components/ui";
import { authenticate, biometricSupport, type BiometricSupport } from "@/lib/biometrics";
import { DEFAULT_PREFS, secure, type Prefs } from "@/lib/secure";
import { applyAppSwitcherProtection } from "@/hooks/use-app-lock";

const TIMEOUTS = [
  { minutes: 0, label: "Immediately" },
  { minutes: 1, label: "After 1 minute" },
  { minutes: 5, label: "After 5 minutes" },
  { minutes: 15, label: "After 15 minutes" },
];

/** Optional biometric unlock after the first sign-in, and when to lock after leaving the app. */
export default function SecurityScreen() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [support, setSupport] = useState<BiometricSupport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = support?.label ?? "biometrics";

  useEffect(() => {
    void secure.getPrefs().then(setPrefs);
    void biometricSupport().then(setSupport);
  }, []);

  const save = async (next: Prefs) => {
    setPrefs(next);
    await secure.setPrefs(next);
    await applyAppSwitcherProtection(next);
  };

  const toggle = async (on: boolean) => {
    setError(null);
    if (on) {
      // Confirm it works before relying on it.
      const ok = await authenticate(`Turn on ${label} unlock`);
      if (!ok) {
        setError("Couldn't confirm it's you. Biometric unlock is still off.");
        return;
      }
    }
    await save({ ...prefs, biometrics: on });
  };

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4">
      {support && !support.available ? <FormError message="Set up Face ID or a fingerprint in your phone settings to use this." /> : null}
      <Card className="p-0">
        <ListRow
          icon="finger-print"
          title={`Unlock with ${label}`}
          subtitle="Ask for it when you open the app"
          right={<Switch accessibilityLabel={`Unlock with ${label}`} value={prefs.biometrics} disabled={!support?.available} onValueChange={(v) => void toggle(v)} />}
        />
      </Card>
      <FormError message={error} />
      {prefs.biometrics ? (
        <>
          <Text className="px-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">Lock the app when I leave it</Text>
          <Card className="p-0">
            {TIMEOUTS.map((t) => (
              <ListRow
                key={t.minutes}
                title={t.label}
                onPress={() => void save({ ...prefs, lockAfterMinutes: t.minutes })}
                right={prefs.lockAfterMinutes === t.minutes ? <Text accessibilityLabel="Selected" className="text-base font-semibold text-brand">✓</Text> : <View />}
              />
            ))}
          </Card>
        </>
      ) : null}
      <Text className="px-1 text-sm text-zinc-500 dark:text-zinc-400">Your face or fingerprint never leaves this phone. FitCRM only learns whether the check passed.</Text>
    </ScrollView>
  );
}
