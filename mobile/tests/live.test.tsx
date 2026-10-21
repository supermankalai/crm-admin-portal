import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AudioSession } from "@livekit/react-native";
import LiveCallScreen from "@/app/live/[kind]/[sessionId]";
import { JoinLiveButton } from "@/components/live-join";
import { liveState, parseLiveLink } from "@/lib/live";
import { __resetSessionForTests, __setSessionForTests } from "@/lib/session";

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: mockBack, canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const gym = (role: "MEMBER" | "TRAINER") => ({ slug: "gym-a", name: "Gym A", brandColor: "#ea580c", logoUrl: null, timezone: "Asia/Kolkata", currency: "INR", role, permissions: [], access: { writable: true, reason: null, isTrial: false, endsAt: null } });
const inMinutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

async function show(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function mockToken(status: number, body: unknown) {
  global.fetch = jest.fn(async () => ({ status, ok: status < 400, json: async () => body })) as unknown as typeof fetch;
}

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  (AudioSession.startAudioSession as jest.Mock).mockClear();
  __resetSessionForTests();
  __setSessionForTests({ phase: "signedIn", user: { id: "u", name: "Alex" }, gym: gym("MEMBER") });
});

describe("when a call can be joined", () => {
  const now = Date.parse("2026-10-21T09:00:00Z");
  it("opens 10 minutes before the start and closes 15 minutes after the end; never for in-person sessions", () => {
    const starts = "2026-10-21T09:15:00Z";
    const ends = "2026-10-21T10:00:00Z";
    expect(liveState("ONLINE", starts, ends, now).state).toBe("early");
    expect(liveState("ONLINE", starts, ends, Date.parse("2026-10-21T09:05:00Z")).state).toBe("open");
    expect(liveState("HYBRID", starts, ends, Date.parse("2026-10-21T10:14:00Z")).state).toBe("open");
    expect(liveState("ONLINE", starts, ends, Date.parse("2026-10-21T10:15:00Z")).state).toBe("ended");
    expect(liveState("IN_PERSON", starts, ends, Date.parse("2026-10-21T09:05:00Z")).state).toBe("none");
  });

  it("reads a push alert's call link, and nothing else", () => {
    expect(parseLiveLink("class:abc123")).toEqual({ kind: "class", sessionId: "abc123" });
    expect(parseLiveLink("pt:x-1")).toEqual({ kind: "pt", sessionId: "x-1" });
    for (const bad of ["video:abc", "class:", "class:a/b", "pt:../x", 42, undefined, null]) expect(parseLiveLink(bad)).toBeNull();
  });
});

describe("the Join button", () => {
  it("says when the call opens, before it does", async () => {
    await show(<JoinLiveButton link={{ kind: "class", sessionId: "s1" }} mode="ONLINE" startsAt={inMinutes(30)} endsAt={inMinutes(90)} timeZone="Asia/Kolkata" />);
    expect(screen.getByText(/you can join from/)).toBeTruthy();
    expect(screen.queryByText("Join online")).toBeNull();
  });

  it("opens the call while it's open", async () => {
    await show(<JoinLiveButton link={{ kind: "pt", sessionId: "p1" }} mode="ONLINE" startsAt={inMinutes(5)} endsAt={inMinutes(65)} timeZone="Asia/Kolkata" label="Join your session" />);
    await fireEvent.press(screen.getByText("Join your session"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/live/[kind]/[sessionId]", params: { kind: "pt", sessionId: "p1" } });
  });

  it("isn't shown for an in-person session", async () => {
    await show(<JoinLiveButton link={{ kind: "class", sessionId: "s1" }} mode="IN_PERSON" startsAt={inMinutes(5)} endsAt={inMinutes(65)} timeZone="Asia/Kolkata" />);
    expect(screen.queryByText("Join online")).toBeNull();
    expect(screen.queryByText(/you can join/)).toBeNull();
  });
});

describe("the call screen", () => {
  it("starts a member's class camera and mic off, and shows why the server said no", async () => {
    mockParams = { kind: "class", sessionId: "s1" };
    mockToken(403, { error: { code: "forbidden", message: "You're on the waitlist. You can join once you have a place." } });
    await show(<LiveCallScreen />);
    expect(screen.getByLabelText("Camera off")).toBeTruthy();
    expect(screen.getByLabelText("Microphone off")).toBeTruthy();
    expect(screen.getByText(/Others in the class see your first name/)).toBeTruthy();
    await fireEvent.press(screen.getByText("Join now"));
    expect(await screen.findByText(/on the waitlist/)).toBeTruthy();
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe("https://api.test/api/mobile/v1/live/class/s1/token");
    expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe("POST");
    expect(AudioSession.startAudioSession).not.toHaveBeenCalled();
  });

  it("joins with the server's token: camera and mic on for PT, then the call with a way out", async () => {
    __setSessionForTests({ phase: "signedIn", user: { id: "u", name: "Tara" }, gym: gym("TRAINER") });
    mockParams = { kind: "pt", sessionId: "p1" };
    mockToken(200, {
      url: "wss://livekit.test",
      token: "header.payload.signature",
      roomName: "g_g__pt_p1",
      identity: "s_t1",
      role: "coach",
      expiresAt: inMinutes(70),
      session: { kind: "pt", id: "p1", title: "Personal training: Mobility", startsAt: inMinutes(5), endsAt: inMinutes(55), deliveryMode: "ONLINE" },
    });
    await show(<LiveCallScreen />);
    expect(screen.getByLabelText("Camera on")).toBeTruthy();
    await fireEvent.press(screen.getByText("Join now"));
    expect(await screen.findByText("Personal training: Mobility")).toBeTruthy();
    expect(AudioSession.startAudioSession).toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Leave the call"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("refuses a link that isn't a call", async () => {
    mockParams = { kind: "video", sessionId: "s1" };
    await show(<LiveCallScreen />);
    expect(screen.getByText(/isn't valid/)).toBeTruthy();
  });
});
