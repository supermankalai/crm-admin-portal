import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Linking, Modal, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Screen } from "@/components/screen";
import { StatusChip } from "@/components/status-chip";
import { Button, Card, ChipGroup, FormError, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { checkInOutcome, createScanGate, failedOutcome, type Outcome } from "@/lib/staff";
import { useCheckIn, useCheckInLookup, useCheckInSetup, type CheckInCandidate } from "@/lib/staff-queries";

const RESULT_SECONDS = 4;

/**
 * Front-desk check-in. Point the camera at a member's app QR code (or printed card) and the result
 * shows full-screen in green or red with the reason. Or search by name / member number. Every
 * attempt is recorded on the server, allowed or not.
 */
export default function CheckInTab() {
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const setup = useCheckInSetup();
  const lookup = useCheckInLookup();
  const checkIn = useCheckIn();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [chosenLocation, setChosenLocation] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<CheckInCandidate[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [gate] = useState(() => createScanGate());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const locations = setup.data?.locations ?? [];
  const locationId = chosenLocation ?? locations[0]?.id ?? null;
  const writable = !!gym?.access.writable;

  // Stop the camera when leaving the tab (battery, privacy).
  useFocusEffect(useCallback(() => () => setScanning(false), []));
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  const dismiss = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOutcome(null);
    gate.release();
  };

  const show = (o: Outcome) => {
    setOutcome(o);
    AccessibilityInfo.announceForAccessibility(`${o.title}. ${o.name ?? ""} ${o.message}`);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(dismiss, RESULT_SECONDS * 1000);
  };

  const admit = async (memberId: string, method: "QR" | "MEMBER_ID" | "NAME_SEARCH") => {
    if (!locationId) return show(failedOutcome("Add a location in the web portal first."));
    try {
      const r = await checkIn.mutateAsync({ memberId, locationId, method });
      setCandidates(null);
      setQuery("");
      show(checkInOutcome(r));
    } catch (e) {
      show(failedOutcome(errorMessage(e)));
    }
  };

  const onScan = async ({ data }: { data: string }) => {
    if (!gate.accept(data)) return;
    try {
      const r = await lookup.mutateAsync(data);
      if (r.candidates.length === 1) return await admit(r.candidates[0].id, r.method);
      if (r.candidates.length === 0) return show(failedOutcome("No member found for this code."));
      setCandidates(r.candidates);
      gate.release();
    } catch (e) {
      show(failedOutcome(errorMessage(e)));
    }
  };

  const search = async () => {
    setSearchError(null);
    if (!query.trim()) return;
    try {
      const r = await lookup.mutateAsync(query.trim());
      setCandidates(r.candidates);
      if (r.candidates.length === 0) setSearchError("No one found. Try a different spelling or the member number.");
    } catch (e) {
      setSearchError(errorMessage(e));
    }
  };

  const startCamera = async () => {
    const p = permission?.granted ? permission : await requestPermission();
    if (p.granted) setScanning(true);
  };

  const disabled = !online || !writable || !locationId;

  return (
    <Screen title="Check-in" onRefresh={() => setup.refetch()}>
      {setup.data ? (
        <View className="flex-row gap-3">
          <Card className="flex-1">
            <Text className="text-sm text-zinc-500 dark:text-zinc-400">Checked in today</Text>
            <Text className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{setup.data.today.allowed}</Text>
          </Card>
          <Card className="flex-1">
            <Text className="text-sm text-zinc-500 dark:text-zinc-400">Turned away</Text>
            <Text className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{setup.data.today.denied}</Text>
          </Card>
        </View>
      ) : null}

      {locations.length > 1 ? (
        <ChipGroup label="Location" options={locations.map((l) => ({ value: l.id, label: l.name }))} value={locationId ?? ""} onChange={setChosenLocation} />
      ) : null}
      {setup.data && locations.length === 0 ? <FormError message="This gym has no locations yet. Add one in the web portal under Settings." /> : null}
      {!writable ? <FormError message="Check-ins are paused while the gym is read-only." /> : null}

      {scanning ? (
        <View className="gap-3">
          <View className="aspect-square overflow-hidden rounded-2xl bg-black">
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              active={!outcome}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={disabled || outcome ? undefined : onScan}
              accessibilityLabel="Camera viewfinder. Hold the member's QR code in front of it."
            />
            <View pointerEvents="none" className="absolute inset-10 rounded-3xl border-4 border-white/80" />
          </View>
          <Button label="Stop camera" variant="secondary" icon="close-outline" onPress={() => setScanning(false)} />
        </View>
      ) : (
        <Card className="items-center gap-3">
          <Ionicons name="qr-code-outline" size={48} color="#71717a" />
          <Text className="text-center text-base text-zinc-700 dark:text-zinc-300">Scan the QR code on a member&apos;s app or printed card.</Text>
          {permission && !permission.granted && !permission.canAskAgain ? (
            <>
              <Text className="text-center text-sm text-zinc-500 dark:text-zinc-400">Camera access is off for this app.</Text>
              <Button label="Open settings" variant="secondary" onPress={() => Linking.openSettings()} />
            </>
          ) : (
            <Button label="Scan with camera" icon="camera-outline" onPress={startCamera} disabled={disabled} />
          )}
        </Card>
      )}

      <Card className="gap-3">
        <TextField label="Or find by name or member number" value={query} onChangeText={setQuery} onSubmitEditing={search} returnKeyType="search" autoCorrect={false} placeholder="e.g. Priya or 1024" />
        <Button label="Find" variant="secondary" icon="search-outline" onPress={search} loading={lookup.isPending && !scanning} disabled={!online || !query.trim()} />
        <FormError message={searchError} />
        {candidates?.map((c) => {
          const allowed = c.decision.result === "ALLOWED";
          return (
            <View key={c.id} className="gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <Pressable accessibilityRole="link" accessibilityLabel={`Open ${c.name}'s profile`} onPress={() => router.push({ pathname: "/members/[memberId]", params: { memberId: c.id } })}>
                <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{c.name}</Text>
                <Text className="text-sm text-zinc-500 dark:text-zinc-400">#{c.memberNumber}</Text>
              </Pressable>
              <View className="flex-row flex-wrap gap-2">
                <StatusChip label={allowed ? "Can check in" : c.decision.message} tone={allowed ? "green" : "red"} />
                {c.overdueInvoices ? <StatusChip label={`${c.overdueInvoices} overdue`} tone="amber" /> : null}
              </View>
              <Button label={allowed ? "Check in" : "Record attempt"} variant={allowed ? "primary" : "secondary"} onPress={() => admit(c.id, /^\d+$/.test(query.trim()) ? "MEMBER_ID" : "NAME_SEARCH")} loading={checkIn.isPending} disabled={disabled} />
            </View>
          );
        })}
      </Card>
      {!online ? <FormError message="You're offline. Check-ins need a connection." /> : null}

      <Modal visible={!!outcome} transparent animationType="fade" onRequestClose={dismiss}>
        {outcome ? <ResultOverlay outcome={outcome} onDismiss={dismiss} /> : null}
      </Modal>
    </Screen>
  );
}

function ResultOverlay({ outcome, onDismiss }: { outcome: Outcome; onDismiss: () => void }) {
  return (
    <Pressable
      testID="checkin-result"
      accessibilityRole="button"
      accessibilityLabel={`${outcome.title}. ${outcome.name ?? ""}. ${outcome.message}. ${outcome.note ?? ""} Tap to continue.`}
      onPress={onDismiss}
      className={`flex-1 items-center justify-center gap-4 p-8 ${outcome.allowed ? "bg-emerald-600" : "bg-red-600"}`}
    >
      <Ionicons name={outcome.allowed ? "checkmark-circle" : "close-circle"} size={140} color="#fff" />
      <Text className="text-center text-4xl font-bold text-white">{outcome.title}</Text>
      {outcome.name ? <Text className="text-center text-2xl font-semibold text-white">{outcome.name}</Text> : null}
      <Text className="text-center text-lg text-white">{outcome.message}</Text>
      {outcome.note ? <Text className="rounded-xl bg-black/20 p-3 text-center text-base text-white">{outcome.note}</Text> : null}
      <Text className="mt-6 text-sm text-white/80">Tap to scan the next member</Text>
    </Pressable>
  );
}
