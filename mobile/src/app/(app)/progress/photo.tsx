import { Alert, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { Button, EmptyState, FormError } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { absoluteUrl } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import { useDeletePhoto, useMemberProgress } from "@/lib/fitness-queries";
import { date } from "@/lib/format";

/** One progress photo, full size. Screenshots are blocked; the image is kept in memory only. */
export default function PhotoViewer() {
  usePreventScreenCapture();
  const { id, takenOn } = useLocalSearchParams<{ id: string; takenOn: string }>();
  const router = useRouter();
  const online = useOnline();
  const q = useMemberProgress();
  const remove = useDeletePhoto();
  const photo = q.data?.photos.find((p) => p.id === id);
  if (!photo) return <EmptyState icon="image-outline" title={q.isPending ? "Loading…" : "Photo not found"} />;

  const confirmDelete = () =>
    Alert.alert("Delete this photo?", "It's removed from the gym's systems too.", [
      { text: "Keep", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(photo.id, { onSuccess: () => router.back() }) },
    ]);

  return (
    <View className="flex-1 gap-4 bg-black p-4">
      <Image
        source={{ uri: absoluteUrl(photo.url)! }}
        style={{ flex: 1 }}
        contentFit="contain"
        cachePolicy="memory"
        accessibilityLabel={`Progress photo from ${date(takenOn)}`}
        accessibilityIgnoresInvertColors
      />
      <FormError message={remove.error ? errorMessage(remove.error) : null} />
      <Button label="Delete photo" variant="danger" icon="trash-outline" onPress={confirmDelete} loading={remove.isPending} disabled={!online} />
    </View>
  );
}
