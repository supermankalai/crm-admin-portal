import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react-native";
import ClassesTab from "@/app/(app)/classes";
import { classBadge, spotsText, type MemberClass } from "@/lib/classes";
import { __resetSessionForTests, __setSessionForTests } from "@/lib/session";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const base: MemberClass = {
  id: "s1",
  startsAt: "2026-10-05T12:30:00.000Z",
  endsAt: "2026-10-05T13:30:00.000Z",
  status: "SCHEDULED",
  className: "Yoga",
  classColor: "#22c55e",
  description: null,
  room: "Studio",
  location: "Main",
  trainer: "Priya",
  capacity: 10,
  booked: 4,
  waitlisted: 0,
  spotsLeft: 6,
  my: null,
  canBook: true,
  canCancel: false,
  cancelDeadline: "2026-10-05T10:30:00.000Z",
};

describe("class display rules", () => {
  it("labels my status, fullness and cancellations in words (not colour alone)", () => {
    expect(classBadge(base)).toBeNull();
    expect(spotsText(base)).toBe("6 of 10 spots left");
    expect(classBadge({ ...base, spotsLeft: 0, waitlisted: 3 })).toEqual({ label: "Full · 3 waiting", tone: "red" });
    expect(classBadge({ ...base, my: { bookingId: "b", status: "WAITLISTED", waitlistPosition: 2 } })).toEqual({ label: "Waitlist #2", tone: "amber" });
    expect(classBadge({ ...base, my: { bookingId: "b", status: "BOOKED", waitlistPosition: null } })?.label).toBe("Booked");
    expect(classBadge({ ...base, status: "CANCELLED" })?.label).toBe("Cancelled");
  });
});

describe("member timetable", () => {
  beforeEach(() => {
    __resetSessionForTests();
    __setSessionForTests({
      phase: "signedIn",
      user: { id: "u", name: "Alex" },
      gym: { slug: "gym-a", name: "Gym A", brandColor: "#ea580c", logoUrl: null, timezone: "Asia/Kolkata", currency: "INR", role: "MEMBER", permissions: [], access: { writable: true, reason: null, isTrial: false, endsAt: null } },
    });
    global.fetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        from: "2026-10-05",
        to: "2026-10-19",
        rules: { bookingDaysAhead: 14, cancelHoursBefore: 2 },
        classes: [base, { ...base, id: "s2", className: "Spin", spotsLeft: 0, waitlisted: 2, my: { bookingId: "b2", status: "WAITLISTED", waitlistPosition: 1 } }],
      }),
    })) as unknown as typeof fetch;
  });

  it("shows classes grouped by day with spots and my waitlist position", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render(
      <QueryClientProvider client={client}>
        <ClassesTab />
      </QueryClientProvider>
    );
    expect(await screen.findByText("Yoga")).toBeTruthy();
    expect(screen.getByText("6 of 10 spots left")).toBeTruthy();
    expect(screen.getByText("Waitlist #1")).toBeTruthy();
    expect(screen.getByText(/Book up to 14 days ahead/)).toBeTruthy();
    expect(screen.getByLabelText(/Yoga, 6:00 pm, with Priya/)).toBeTruthy();
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe("https://api.test/api/mobile/v1/member/classes");
  });
});
