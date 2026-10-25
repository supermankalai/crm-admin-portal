/* Jest setup: in-memory stand-ins for native modules. */
process.env.EXPO_PUBLIC_API_URL = "https://api.test";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@react-native-community/netinfo", () => require("@react-native-community/netinfo/jest/netinfo-mock.js"));

// SecureStore: an in-memory keychain the tests can inspect.
jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});

jest.mock("expo-local-authentication", () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 },
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  supportedAuthenticationTypesAsync: jest.fn(async () => [1]),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

// LiveKit (video calls): native WebRTC isn't available in Jest. The call screen's pre-join step
// and the token request are tested; the room itself is a pass-through.
jest.mock("@livekit/react-native", () => ({
  registerGlobals: jest.fn(),
  AudioSession: { startAudioSession: jest.fn(async () => undefined), stopAudioSession: jest.fn(async () => undefined) },
  LiveKitRoom: ({ children }: { children: unknown }) => children,
  VideoTrack: () => null,
  isTrackReference: () => false,
  useTracks: () => [],
  useRoomContext: () => ({ disconnect: jest.fn(async () => undefined) }),
  useLocalParticipant: () => ({ localParticipant: { setMicrophoneEnabled: jest.fn(), setCameraEnabled: jest.fn(), getTrackPublication: () => undefined }, isMicrophoneEnabled: false, isCameraEnabled: false }),
}));
jest.mock("livekit-client", () => ({ Track: { Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen_share" } } }));
