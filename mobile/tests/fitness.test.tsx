import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { progressSummary } from "@fitcrm/shared/domain/progress";
import { progressEntrySchema, workoutPlanSchema } from "@fitcrm/shared/validation/fitness";
import WorkoutsTab from "@/app/(app)/workouts";
import { ProgressChart } from "@/components/progress-chart";
import { blankPlan, changeText, chartScale, exerciseLine, localToIso, planToForm } from "@/lib/fitness";
import { __resetSessionForTests, __setSessionForTests } from "@/lib/session";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

describe("fitness display rules", () => {
  it("describes exercises and changes in words", () => {
    expect(exerciseLine({ sets: 4, reps: "6-8", restSeconds: 150 })).toBe("4 × 6-8 · rest 2 min 30 s");
    expect(exerciseLine({ sets: 3, reps: null, restSeconds: 60 })).toBe("3 sets · rest 1 min");
    expect(exerciseLine({ sets: null, reps: null, restSeconds: null })).toBe("");
    expect(changeText("weightKg", -2.4)).toBe("−2.4 kg");
    expect(changeText("waistCm", 1)).toBe("+1 cm");
    expect(changeText("weightKg", 0)).toBe("no change");
  });

  it("turns a gym-local date and time into an instant", () => {
    expect(localToIso("2026-10-09", "07:30", "Asia/Kolkata")).toBe("2026-10-09T02:00:00.000Z");
    expect(localToIso("2026-02-30", "07:30", "Asia/Kolkata")).toBeNull();
    expect(localToIso("2026-10-09", "25:00", "Asia/Kolkata")).toBeNull();
  });

  it("pads the chart scale so the line never touches the edges", () => {
    const s = chartScale([80, 82], 100);
    expect(s.y(82)).toBeGreaterThan(0);
    expect(s.y(80)).toBeLessThan(100);
    expect(Number.isFinite(chartScale([80], 100).y(80))).toBe(true);
  });

  it("validates forms with the server's rules", () => {
    const entry = progressEntrySchema.parse({ recordedOn: "2026-10-01", weightKg: "82,45", bodyFatPct: "", chestCm: "", waistCm: "90", hipsCm: "", armCm: "", thighCm: "" });
    expect(entry).toEqual({ recordedOn: "2026-10-01", values: { weightKg: 82.5, waistCm: 90 } });
    expect(progressEntrySchema.safeParse({ recordedOn: "2026-10-01", weightKg: "", bodyFatPct: "", chestCm: "", waistCm: "", hipsCm: "", armCm: "", thighCm: "" }).success).toBe(false);
    const blank = blankPlan();
    // A new plan starts with one empty exercise, which must be named before saving.
    expect(workoutPlanSchema.safeParse({ ...blank, title: "Push day" }).success).toBe(false);
    const named = { ...blank, title: "Push day", days: [{ ...blank.days[0], exercises: [{ ...blank.days[0].exercises[0], name: "Bench press" }] }] };
    expect(workoutPlanSchema.parse(named).days[0].exercises[0]).toEqual({ name: "Bench press", sets: 3, reps: "10", restSeconds: 60, notes: null });
    const saved = { id: "p", title: "T", notes: null, status: "ACTIVE" as const, member: null, trainer: "Priya", canEdit: true, updatedAt: "2026-10-01T00:00:00.000Z", days: [{ id: "d", title: "A", exercises: [{ id: "e", name: "Squat", sets: 5, reps: "5", restSeconds: null, notes: null }] }] };
    expect(workoutPlanSchema.parse(planToForm(saved)).days[0].exercises[0]).toEqual({ name: "Squat", sets: 5, reps: "5", restSeconds: null, notes: null });
  });

  it("summarises progress per measurement", () => {
    const s = progressSummary([
      { recordedOn: "2026-09-01", values: { weightKg: 84 } },
      { recordedOn: "2026-10-01", values: { weightKg: 82.5, waistCm: 90 } },
    ]);
    expect(s).toEqual([
      expect.objectContaining({ key: "weightKg", latest: 82.5, change: -1.5, since: "2026-09-01" }),
      expect.objectContaining({ key: "waistCm", latest: 90, change: null }),
    ]);
  });
});

describe("progress chart", () => {
  it("gives screen readers the start, latest value and change", async () => {
    await render(<ProgressChart points={[{ date: "2026-08-01", value: 84 }, { date: "2026-10-01", value: 82.5 }]} unit="kg" label="Weight" />);
    expect(screen.getByLabelText(/Weight chart: 84 kg on .*82.5 kg on .*minus 1.5 kg/)).toBeTruthy();
  });
});

describe("member workouts", () => {
  const replies: Record<string, unknown> = {
    "/member/workouts:GET": {
      plans: [{ id: "p1", title: "Strength block", notes: "Keep the back straight", trainer: "Priya", days: [{ id: "d1", title: "Day A", exercises: [{ id: "e1", name: "Back squat", sets: 4, reps: "6-8", restSeconds: 150, notes: null }], lastCompletedAt: null, timesCompleted: 0 }] }],
      recent: [],
      thisWeek: 2,
    },
    "/member/training-sessions:GET": { sessions: [] },
    "/member/workouts/d1/complete:POST": { completionId: "c1", completedAt: "2026-10-08T10:00:00.000Z" },
  };

  beforeEach(() => {
    __resetSessionForTests();
    __setSessionForTests({
      phase: "signedIn",
      user: { id: "u", name: "Alex" },
      gym: { slug: "gym-a", name: "Gym A", brandColor: "#ea580c", logoUrl: null, timezone: "Asia/Kolkata", currency: "INR", role: "MEMBER", permissions: [], access: { writable: true, reason: null, isTrial: false, endsAt: null } },
    });
    global.fetch = jest.fn(async (url: string, init?: { method?: string }) => {
      const path = new URL(url).pathname.replace("/api/mobile/v1", "");
      const body = replies[`${path}:${init?.method ?? "GET"}`];
      return { status: body ? (init?.method === "POST" ? 201 : 200) : 404, ok: !!body, json: async () => body ?? { error: { code: "not_found", message: "Not found" } } };
    }) as unknown as typeof fetch;
  });

  it("shows the plan with sets, reps and rest, and marks a day done", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await render(
      <QueryClientProvider client={client}>
        <WorkoutsTab />
      </QueryClientProvider>
    );
    expect(await screen.findByText("Strength block")).toBeTruthy();
    expect(screen.getByText("From Priya")).toBeTruthy();
    expect(screen.getByText("4 × 6-8 · rest 2 min 30 s")).toBeTruthy();
    expect(screen.getByText(/2 workouts in the last 7 days/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Mark as done"));
    expect(await screen.findByText("Nice work — logged.")).toBeTruthy();
    const post = (global.fetch as jest.Mock).mock.calls.find(([u, i]) => u.endsWith("/member/workouts/d1/complete") && i?.method === "POST");
    expect(JSON.parse(post[1].body)).toEqual({ note: "" });
    await view.unmount();
  });
});
