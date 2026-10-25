import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import CheckInTab from "@/app/(app)/checkin";
import { bookingText, checkInOutcome, createScanGate, minorToInput } from "@/lib/staff";
import { __resetSessionForTests, __setSessionForTests } from "@/lib/session";
import { routesFor, tabsFor } from "@/nav/tabs";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useFocusEffect: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-camera", () => ({ CameraView: () => null, useCameraPermissions: () => [{ granted: false, canAskAgain: true }, jest.fn()] }));

describe("staff display rules", () => {
  it("says the check-in result and reason in words, with overdue and duplicate notes", () => {
    expect(checkInOutcome({ result: "ALLOWED", message: "Monthly, until 4 Nov", name: "Priya", duplicate: false, overdueInvoices: 0 })).toEqual({ allowed: true, title: "Allowed in", message: "Monthly, until 4 Nov", name: "Priya", note: null });
    const denied = checkInOutcome({ result: "DENIED_EXPIRED", message: "Membership expired on 1 Oct", name: "Ravi", duplicate: true, overdueInvoices: 2 });
    expect(denied).toMatchObject({ allowed: false, title: "Not allowed", message: "Membership expired on 1 Oct" });
    expect(denied.note).toMatch(/not counted twice.*2 overdue invoices/);
  });

  it("handles one scanned code once, not on every camera frame", () => {
    let t = 0;
    const gate = createScanGate(4000, () => t);
    expect(gate.accept("A")).toBe(true);
    expect(gate.accept("B")).toBe(false); // busy with A
    gate.release();
    t = 1000;
    expect(gate.accept("A")).toBe(false); // same code still in front of the camera
    expect(gate.accept("B")).toBe(true);
    gate.release();
    t = 6000;
    expect(gate.accept("A")).toBe(true);
  });

  it("formats booking numbers and payment amounts", () => {
    expect(bookingText({ booked: 8, capacity: 10, waitlisted: 0 })).toBe("8/10 booked");
    expect(bookingText({ booked: 10, capacity: 10, waitlisted: 3 })).toBe("10/10 booked · 3 waiting");
    expect(minorToInput(118000)).toBe("1180");
    expect(minorToInput(118050)).toBe("1180.50");
  });

  it("lets owners and managers open check-in without a tab, but not trainers or members", () => {
    expect(tabsFor("OWNER")).not.toContain("checkin");
    expect(routesFor("OWNER")).toContain("checkin");
    expect(routesFor("MANAGER")).toContain("checkin");
    expect(routesFor("TRAINER")).not.toContain("checkin");
    expect(routesFor("MEMBER")).not.toContain("checkin");
  });
});

describe("check-in screen", () => {
  const replies: Record<string, unknown> = {
    "/staff/check-in:GET": { locations: [{ id: "loc1", name: "Main" }], today: { allowed: 12, denied: 1 } },
    "/staff/check-in/lookup:POST": { method: "NAME_SEARCH", candidates: [{ id: "m1", name: "Priya Nair", memberNumber: "1024", decision: { result: "ALLOWED", message: "Monthly until 4 Nov" }, overdueInvoices: 1 }] },
    "/staff/check-in:POST": { memberId: "m1", name: "Priya Nair", result: "ALLOWED", message: "Monthly until 4 Nov", duplicate: false, overdueInvoices: 1, checkedInAt: "2026-10-04T10:00:00.000Z" },
  };

  beforeEach(() => {
    __resetSessionForTests();
    __setSessionForTests({
      phase: "signedIn",
      user: { id: "u", name: "Desk" },
      gym: { slug: "gym-a", name: "Gym A", brandColor: "#ea580c", logoUrl: null, timezone: "Asia/Kolkata", currency: "INR", role: "FRONT_DESK", permissions: ["checkin.perform"], access: { writable: true, reason: null, isTrial: false, endsAt: null } },
    });
    global.fetch = jest.fn(async (url: string, init?: { method?: string }) => {
      const path = new URL(url).pathname.replace("/api/mobile/v1", "");
      const body = replies[`${path}:${init?.method ?? "GET"}`];
      return { status: body ? (init?.method === "POST" && path === "/staff/check-in" ? 201 : 200) : 404, ok: !!body, json: async () => body ?? { error: { code: "not_found", message: "Not found" } } };
    }) as unknown as typeof fetch;
  });

  it("finds a member by name, checks them in, and shows the result full-screen", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await render(
      <QueryClientProvider client={client}>
        <CheckInTab />
      </QueryClientProvider>
    );
    expect(await screen.findByText("12")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Or find by name or member number"), "Priya");
    await fireEvent.press(screen.getByLabelText("Find"));
    expect(await screen.findByText("Priya Nair")).toBeTruthy();
    expect(screen.getByText("1 overdue")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Check in"));
    const result = await screen.findByTestId("checkin-result");
    expect(result.props.accessibilityLabel).toMatch(/Allowed in\. Priya Nair\. Monthly until 4 Nov\. 1 overdue invoice/);
    const post = (global.fetch as jest.Mock).mock.calls.find(([u, i]) => u.endsWith("/staff/check-in") && i?.method === "POST");
    expect(JSON.parse(post[1].body)).toEqual({ memberId: "m1", locationId: "loc1", method: "NAME_SEARCH" });
    await view.unmount();
  });
});
