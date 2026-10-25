import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { AudioSession, isTrackReference, LiveKitRoom, registerGlobals, useLocalParticipant, useRoomContext, useTracks, VideoTrack, type TrackReferenceOrPlaceholder } from "@livekit/react-native";
import { Track, type LocalVideoTrack } from "livekit-client";
import { Button, FormError } from "@/components/ui";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { useLiveToken, type LiveLink } from "@/lib/live";

// WebRTC globals for livekit-client, once, before any call.
registerGlobals();

type Joined = { url: string; token: string; title: string };

/**
 * An online class or PT session. First a short "ready?" step: what you're joining, and whether
 * your camera and microphone start on (in classes, off by default). Joining asks the server for a
 * token, which it gives only to the session's trainer and its member(s) while the call is open.
 */
export default function LiveCallScreen() {
  const params = useLocalSearchParams<{ kind: string; sessionId: string }>();
  const router = useRouter();
  const { gym } = useSession();
  const link: LiveLink | null = params.kind === "class" || params.kind === "pt" ? { kind: params.kind, sessionId: String(params.sessionId) } : null;
  // Members join a class quietly; in a PT session (and as the trainer) camera and mic start on.
  const quietStart = link?.kind === "class" && gym?.role === "MEMBER";
  const [camera, setCamera] = useState(!quietStart);
  const [mic, setMic] = useState(!quietStart);
  const [joined, setJoined] = useState<Joined | null>(null);
  const join = useLiveToken();

  const leave = () => {
    setJoined(null);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  if (!link) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-zinc-950 p-6">
        <Text className="text-lg text-white">This call link isn&apos;t valid.</Text>
        <Button label="Back" variant="secondary" onPress={leave} />
      </SafeAreaView>
    );
  }

  if (joined) {
    return (
      <SafeAreaView className="flex-1 bg-black" edges={["top", "bottom"]}>
        <LiveKitRoom serverUrl={joined.url} token={joined.token} connect audio={mic} video={camera} options={{ adaptiveStream: true, dynacast: true }} onDisconnected={leave}>
          <InCall title={joined.title} onLeave={leave} />
        </LiveKitRoom>
      </SafeAreaView>
    );
  }

  const start = () =>
    join.mutate(link, {
      onSuccess: async (r) => {
        await AudioSession.startAudioSession();
        setJoined({ url: r.url, token: r.token, title: r.session.title });
      },
    });

  return (
    <SafeAreaView className="flex-1 gap-6 bg-zinc-950 p-6">
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={leave} className="h-12 w-12 items-center justify-center self-end">
        <Ionicons name="close" size={28} color="white" />
      </Pressable>
      <View className="gap-2">
        <Text accessibilityRole="header" className="text-2xl font-bold text-white">
          {link.kind === "class" ? "Join the online class" : "Join your online session"}
        </Text>
        <Text className="text-base text-zinc-300">
          {link.kind === "class" && gym?.role === "MEMBER"
            ? "Others in the class see your first name. Your camera and microphone start off; turn them on whenever you like."
            : "Your camera and microphone start on. Nothing is recorded."}
        </Text>
      </View>
      <View className="gap-3">
        <Toggle icon={camera ? "videocam" : "videocam-off"} label={camera ? "Camera on" : "Camera off"} on={camera} onPress={() => setCamera((v) => !v)} />
        <Toggle icon={mic ? "mic" : "mic-off"} label={mic ? "Microphone on" : "Microphone off"} on={mic} onPress={() => setMic((v) => !v)} />
      </View>
      <FormError message={join.error ? errorMessage(join.error) : null} />
      <Button label="Join now" icon="videocam-outline" onPress={start} loading={join.isPending} testID="live-join" />
    </SafeAreaView>
  );
}

function Toggle({ icon, label, on, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress} className="min-h-12 flex-row items-center gap-3 rounded-2xl bg-zinc-800 px-4 py-3">
      <Ionicons name={icon} size={22} color={on ? "white" : "#a1a1aa"} />
      <Text className="text-base text-white">{label}</Text>
    </Pressable>
  );
}

/** The call: everyone's camera in a grid, and mic, camera, flip and leave. */
function InCall({ title, onLeave }: { title: string; onLeave: () => void }) {
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false });
  const { width } = useWindowDimensions();
  const [front, setFront] = useState(true);
  const columns = tracks.length <= 1 ? 1 : 2;

  // The phone's audio goes back to normal after the call.
  useEffect(() => () => void AudioSession.stopAudioSession(), []);

  const flip = async () => {
    const pub = localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.track as LocalVideoTrack | undefined;
    if (!track) return;
    await track.restartTrack({ facingMode: front ? "environment" : "user" });
    setFront((f) => !f);
  };

  return (
    <View className="flex-1">
      <Text accessibilityRole="header" numberOfLines={1} className="px-4 py-2 text-base font-semibold text-white">
        {title}
      </Text>
      <FlatList
        data={tracks}
        key={columns}
        numColumns={columns}
        keyExtractor={(t) => `${t.participant.identity}:${t.source}`}
        renderItem={({ item }) => <Tile trackRef={item} size={width / columns} />}
      />
      <View className="flex-row items-center justify-center gap-4 py-4">
        <RoundButton icon={isMicrophoneEnabled ? "mic" : "mic-off"} label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"} onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)} />
        <RoundButton icon={isCameraEnabled ? "videocam" : "videocam-off"} label={isCameraEnabled ? "Turn camera off" : "Turn camera on"} onPress={() => void localParticipant.setCameraEnabled(!isCameraEnabled)} />
        {isCameraEnabled ? <RoundButton icon="camera-reverse" label="Switch camera" onPress={() => void flip()} /> : null}
        <RoundButton
          icon="call"
          label="Leave the call"
          danger
          onPress={() => {
            void room.disconnect();
            onLeave();
          }}
        />
      </View>
    </View>
  );
}

function Tile({ trackRef, size }: { trackRef: TrackReferenceOrPlaceholder; size: number }) {
  const name = trackRef.participant.name || "Guest";
  return (
    <View style={{ width: size, height: size * 0.75 }} className="p-1">
      <View className="flex-1 overflow-hidden rounded-xl bg-zinc-800">
        {isTrackReference(trackRef) && !trackRef.publication.isMuted ? (
          <VideoTrack trackRef={trackRef} style={{ flex: 1 }} objectFit="cover" mirror={trackRef.participant.isLocal} />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Ionicons name="person-circle-outline" size={48} color="#71717a" />
          </View>
        )}
        <Text numberOfLines={1} className="absolute bottom-1 left-2 rounded bg-black/50 px-1 text-xs text-white">
          {trackRef.participant.isLocal ? `${name} (you)` : name}
        </Text>
      </View>
    </View>
  );
}

function RoundButton({ icon, label, onPress, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} className={`h-14 w-14 items-center justify-center rounded-full ${danger ? "bg-red-600" : "bg-zinc-700"}`}>
      <Ionicons name={icon} size={24} color="white" style={danger ? { transform: [{ rotate: "135deg" }] } : undefined} />
    </Pressable>
  );
}

