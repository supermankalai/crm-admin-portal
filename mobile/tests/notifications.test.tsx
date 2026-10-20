import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import DeleteAccount from "@/app/(app)/more/delete-account";
import NotificationSettings from "@/app/(app)/more/notification-settings";
import InboxScreen from "@/app/(app)/more/notifications";
import { targetRoute } from "@/lib/inbox-queries";
import { __resetSessionForTests, __setSessionForTests } from "@/lib/session";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }), useFocusEffect: (fn: () => void) => fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/push", () => ({ pushAvailable: () => true, pushPermission: async () => "not-asked", registerForPush: jest.fn(async () => "registered") }));

const member = { slug: "gym-a", name: "Gym A", brandColor: "#ea580c", logoUrl: null, timezone: "Asia/Kolkata", currency: "INR", role: "MEMBER" as const, permissions: [], access: { writable: true, reason: null, isTrial: false, endsAt: null } };

function mockApi(replies: Record<string, unknown>) {
  global.fetch = jest.fn(async (url: string, init?: { method?: string }) => {
    const path = new URL(url).pathname.replace("/api/mobile/v1", "");
    const body = replies[`${path}:${init?.method ?? "GET"}`];
    return { status: body ? 200 : 404, ok: !!body, json: async () => body ?? { error: { code: "not_found", message: "Not found" } } };
  }) as unknown as typeof fetch;
}
const calls = (method: string, suffix: string) => (global.fetch as jest.Mock).mock.calls.filter(([u, i]) => u.includes(suffix) && (i?.method ?? "GET") === method);

async function show(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockPush.mockClear();
  __resetSessionForTests();
  __setSessionForTests({ phase: "signedIn", user: { id: "u", name: "Alex" }, gym: member });
});

describe("notification targets", () => {
  it("opens a screen only when the role has it", () => {
    expect(targetRoute("classes", "MEMBER")).toBe("/classes");
    expect(targetRoute("membership", "MEMBER")).toBe("/card/membership");
    expect(targetRoute("alerts", "MEMBER")).toBeNull();
    expect(targetRoute("alerts", "OWNER")).toBe("/alerts");
    expect(targetRoute("members", "TRAINER")).toBeNull();
    expect(targetRoute(null, "OWNER")).toBeNull();
  });
});

describe("inbox", () => {
  it("shows unread first-class, marks read on tap and opens the related screen", async () => {
    mockApi({
      "/notifications:GET": {
        unread: 1,
        nextCursor: null,
        items: [
          { id: "n1", type: "CLASS_REMINDER", title: "Class reminder", body: "Spin starts at 6:00 pm. See you there!", target: "classes", readAt: null, createdAt: "2026-10-16T12:00:00.000Z" },
          { id: "n2", type: "ANNOUNCEMENT", title: "New hours", body: "Opening at 5:30 am.", target: "announcements", readAt: "2026-10-15T10:00:00.000Z", createdAt: "2026-10-15T09:00:00.000Z" },
        ],
      },
      "/notifications/n1/read:POST": { ok: true },
      "/notifications/read-all:POST": { marked: 1 },
    });
    const view = await show(<InboxScreen />);
    expect(await screen.findByText("1 unread")).toBeTruthy();
    expect(screen.getByLabelText(/^Unread\. Class reminder\. Spin starts at 6:00 pm/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Unread\. Class reminder/));
    expect(mockPush).toHaveBeenCalledWith("/classes");
    expect(calls("POST", "/notifications/n1/read")).toHaveLength(1);
    await fireEvent.press(screen.getByLabelText("Mark all read"));
    expect(calls("POST", "/notifications/read-all")).toHaveLength(1);
    await view.unmount();
  });
});

describe("alert settings", () => {
  it("shows only this role's categories and saves a switch", async () => {
    mockApi({
      "/me/notification-preferences:GET": {
        preferences: { classReminders: true, waitlist: true, membership: true, payments: true, announcements: true, staffAlerts: true, training: true },
        available: ["classReminders", "waitlist", "membership", "payments", "announcements", "training"],
      },
      "/me/notification-preferences:PUT": {
        preferences: { classReminders: false, waitlist: true, membership: true, payments: true, announcements: true, staffAlerts: true, training: true },
        available: ["classReminders", "waitlist", "membership", "payments", "announcements", "training"],
      },
    });
    const view = await show(<NotificationSettings />);
    expect(await screen.findByLabelText("Class reminders")).toBeTruthy();
    expect(screen.queryByLabelText("Gym alerts")).toBeNull();
    expect(screen.getByLabelText("Personal training")).toBeTruthy();
    expect(screen.getByLabelText("Turn on alerts")).toBeTruthy();
    await fireEvent(screen.getByLabelText("Class reminders"), "valueChange", false);
    const put = calls("PUT", "/me/notification-preferences");
    expect(JSON.parse(put[0][1].body)).toEqual({ classReminders: false });
    await view.unmount();
  });
});

describe("account deletion", () => {
  it("needs an explicit tick before sending", async () => {
    mockApi({ "/member/deletion-request:POST": { status: "REQUESTED", requestedAt: "2026-10-16T12:00:00.000Z" } });
    const view = await show(<DeleteAccount />);
    const send = screen.getByLabelText("Ask the gym to delete my account");
    expect(send.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole("checkbox"));
    await fireEvent.press(screen.getByLabelText("Ask the gym to delete my account"));
    expect(await screen.findByText(/Request sent/)).toBeTruthy();
    expect(JSON.parse(calls("POST", "/member/deletion-request")[0][1].body)).toEqual({ reason: "", confirm: true });
    await view.unmount();
  });
});
