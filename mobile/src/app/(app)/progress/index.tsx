import { useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { MEASUREMENTS, progressSummary, seriesFor, type MeasurementKey } from "@fitcrm/shared/domain/progress";
import { ProgressChart } from "@/components/progress-chart";
import { Screen } from "@/components/screen";
import { Button, Card, ChipGroup, EmptyState, FormError, ListRow, Skeleton } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { absoluteUrl } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import { changeText, formatValue } from "@/lib/fitness";
import { useMemberProgress, useUploadPhoto } from "@/lib/fitness-queries";
import { date, localDay } from "@/lib/format";

/**
 * Measurements over time (chart + list) and progress photos. Photos are private: only the member
 * and their assigned trainers can open them, links last 5 minutes and nothing is cached on disk.
 */
export default function ProgressTab() {
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const q = useMemberProgress();
  const upload = useUploadPhoto();
  const [metric, setMetric] = useState<MeasurementKey>("weightKg");
  const writable = !!gym?.access.writable;
  const entries = q.data?.entries ?? [];
  const summary = progressSummary(entries);
  const tracked = MEASUREMENTS.filter((m) => summary.some((s) => s.key === m.key));
  const shownMetric = tracked.some((m) => m.key === metric) ? metric : (tracked[0]?.key ?? "weightKg");
  const meta = MEASUREMENTS.find((m) => m.key === shownMetric)!;

  const addPhoto = async (source: "camera" | "library") => {
    const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", `Allow access to your ${source === "camera" ? "camera" : "photos"} in Settings to add progress photos.`, [
        { text: "Not now", style: "cancel" },
        { text: "Open Settings", onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.8, exif: false, allowsEditing: false };
    const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return;
    upload.mutate({ uri: result.assets[0].uri, takenOn: localDay(new Date().toISOString(), gym?.timezone ?? "UTC") });
  };
  const choosePhoto = () =>
    Alert.alert("Add a progress photo", "Only you and your trainer can see it. Location data is removed.", [
      { text: "Take photo", onPress: () => addPhoto("camera") },
      { text: "Choose from library", onPress: () => addPhoto("library") },
      { text: "Cancel", style: "cancel" },
    ]);

  return (
    <Screen title="Progress" onRefresh={() => q.refetch()}>
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button label="Log measurements" icon="add-circle-outline" onPress={() => router.push("/progress/log")} disabled={!online || !writable} />
        </View>
        <Button label="Photo" variant="secondary" icon="camera-outline" onPress={choosePhoto} loading={upload.isPending} disabled={!online || !writable} />
      </View>
      <FormError message={upload.error ? errorMessage(upload.error) : null} />

      {q.isPending ? (
        <Skeleton className="h-56 w-full" />
      ) : q.error && !q.data ? (
        <FormError message={errorMessage(q.error)} />
      ) : entries.length === 0 ? (
        <EmptyState icon="trending-up-outline" title="Start tracking" description="Log your weight and measurements every week or two to see your progress here." />
      ) : (
        <>
          <View className="flex-row flex-wrap gap-3">
            {summary.map((s) => (
              <View key={s.key} accessible className="w-[47%] grow rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <Text className="text-sm text-zinc-500 dark:text-zinc-400">{s.label}</Text>
                <Text className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{formatValue(s.key, s.latest)}</Text>
                {s.change !== null ? <Text className="text-xs text-zinc-500 dark:text-zinc-400">{`${changeText(s.key, s.change)} since ${date(s.since)}`}</Text> : null}
              </View>
            ))}
          </View>

          <Card className="gap-3">
            {tracked.length > 1 ? <ChipGroup options={tracked.map((m) => ({ value: m.key, label: m.label }))} value={shownMetric} onChange={setMetric} /> : null}
            <Text accessibilityRole="header" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {meta.label} ({meta.unit})
            </Text>
            <ProgressChart points={seriesFor(entries, shownMetric)} unit={meta.unit} label={meta.label} />
          </Card>

          <Text accessibilityRole="header" className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Entries
          </Text>
          <View className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            {[...entries].reverse().slice(0, 30).map((e) => (
              <ListRow
                key={e.id}
                title={date(e.recordedOn)}
                subtitle={MEASUREMENTS.filter((m) => e.values[m.key] !== undefined).map((m) => `${m.label} ${formatValue(m.key, e.values[m.key]!)}`).join(" · ")}
                onPress={() => router.push({ pathname: "/progress/log", params: { recordedOn: e.recordedOn, entryId: e.id } })}
                accessibilityHint="Edit or delete this entry"
              />
            ))}
          </View>
        </>
      )}

      {q.data?.photos.length ? (
        <>
          <Text accessibilityRole="header" className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Photos
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {q.data.photos.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Progress photo from ${date(p.takenOn)}`}
                onPress={() => router.push({ pathname: "/progress/photo", params: { id: p.id, takenOn: p.takenOn } })}
                className="w-[31%] overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800"
              >
                <Image source={{ uri: absoluteUrl(p.url)! }} style={{ width: "100%", aspectRatio: 3 / 4 }} contentFit="cover" cachePolicy="memory" accessibilityIgnoresInvertColors />
                <Text className="px-1.5 py-1 text-xs text-zinc-600 dark:text-zinc-300">{date(p.takenOn)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
