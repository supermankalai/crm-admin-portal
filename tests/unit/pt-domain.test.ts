import { describe, expect, it } from "vitest";
import { completionRate, noShowRate, packageState, pickPackage, ptAssignedMemberText, ptCreditsLowMemberText, ptPackageExpiringText, targetProgress } from "@/domain/pt";
import { ptPackageSchema, sellPtPackageSchema } from "@/lib/validation/pt";
import { assignTrainerSchema, bookPtSessionSchema, targetsFrom } from "@/lib/validation/pt";

const entries = [
  { recordedOn: "2026-07-01", values: { weightKg: 90, bodyFatPct: 30 } },
  { recordedOn: "2026-08-01", values: { weightKg: 86 } },
  { recordedOn: "2026-09-01", values: { weightKg: 84, bodyFatPct: 27 } },
];

describe("progress toward PT targets", () => {
  it("measures from where the client was when training began", () => {
    const [weight, fat] = targetProgress(entries, { targetWeightKg: 80, targetBodyFatPct: 24 }, "2026-07-15");
    expect(weight).toMatchObject({ start: 90, current: 84, target: 80, percent: 60, remaining: 4, reached: false });
    expect(fat).toMatchObject({ start: 30, current: 27, percent: 50 });
  });

  it("uses the first measurement when there was none before the start", () => {
    expect(targetProgress(entries, { targetWeightKg: 80 }, "2026-06-01")[0].start).toBe(90);
    expect(targetProgress(entries, { targetWeightKg: 80 }, "2026-08-10")[0]).toMatchObject({ start: 86, percent: 33 });
  });

  it("works for gaining as well as losing, caps at 100 and never goes negative", () => {
    const gain = [
      { recordedOn: "2026-01-01", values: { weightKg: 60 } },
      { recordedOn: "2026-03-01", values: { weightKg: 64 } },
    ];
    expect(targetProgress(gain, { targetWeightKg: 62 }, "2026-01-01")[0]).toMatchObject({ percent: 100, remaining: 0, reached: true });
    expect(targetProgress(gain, { targetWeightKg: 70 }, "2026-01-01")[0]).toMatchObject({ percent: 40, remaining: 6 });
    const wrongWay = [
      { recordedOn: "2026-01-01", values: { weightKg: 80 } },
      { recordedOn: "2026-02-01", values: { weightKg: 82 } },
    ];
    expect(targetProgress(wrongWay, { targetWeightKg: 75 }, "2026-01-01")[0]).toMatchObject({ percent: 0, remaining: 7, reached: false });
  });

  it("skips targets without measurements, and no targets at all", () => {
    expect(targetProgress([{ recordedOn: "2026-01-01", values: { waistCm: 80 } }], { targetWeightKg: 70 }, "2026-01-01")).toEqual([]);
    expect(targetProgress(entries, null, "2026-01-01")).toEqual([]);
    expect(targetProgress(entries, { note: "Just feel better" }, "2026-01-01")).toEqual([]);
  });
});

describe("rates", () => {
  it("completion and no-show rates are whole percents, null when there's nothing to measure", () => {
    expect(completionRate(9, 12)).toBe(75);
    expect(completionRate(15, 12)).toBe(100);
    expect(completionRate(3, 0)).toBeNull();
    expect(noShowRate(9, 1)).toBe(10);
    expect(noShowRate(0, 0)).toBeNull();
  });
});

describe("inbox wording", () => {
  it("names the trainer and the goal inside the app", () => {
    expect(ptAssignedMemberText("Priya", "MUSCLE_GAIN").body).toBe("Priya is now your personal trainer, working with you on muscle gain.");
    expect(ptAssignedMemberText("Priya", null).body).toBe("Priya is now your personal trainer.");
  });
});

describe("PT forms", () => {
  const base = { memberId: "m1", trainerId: "t1", goal: "", targetWeightKg: "", targetBodyFatPct: "", targetDate: "", note: "" };

  it("turns blank targets into nothing and keeps the rest", () => {
    const empty = assignTrainerSchema.parse(base);
    expect(empty.goal).toBeNull();
    expect(targetsFrom(empty)).toBeNull();
    const full = assignTrainerSchema.parse({ ...base, goal: "WEIGHT_LOSS", targetWeightKg: "72,46", targetDate: "2026-12-31", note: " Knee " });
    expect(targetsFrom(full)).toEqual({ targetWeightKg: 72.5, targetDate: "2026-12-31", note: "Knee" });
  });

  it("rejects targets out of range and unknown goals", () => {
    expect(assignTrainerSchema.safeParse({ ...base, targetWeightKg: "5" }).success).toBe(false);
    expect(assignTrainerSchema.safeParse({ ...base, targetBodyFatPct: "90" }).success).toBe(false);
    expect(assignTrainerSchema.safeParse({ ...base, targetDate: "31/12/2026" }).success).toBe(false);
    expect(assignTrainerSchema.safeParse({ ...base, goal: "BULKING" }).success).toBe(false);
  });

  it("checks session times and length", () => {
    const ok = { memberId: "m1", date: "2026-11-02", startTime: "07:30", durationMinutes: "60", focus: "" };
    expect(bookPtSessionSchema.parse(ok)).toMatchObject({ durationMinutes: 60, focus: null });
    expect(bookPtSessionSchema.safeParse({ ...ok, startTime: "7:30" }).success).toBe(false);
    expect(bookPtSessionSchema.safeParse({ ...ok, durationMinutes: "10" }).success).toBe(false);
    expect(bookPtSessionSchema.safeParse({ ...ok, durationMinutes: "300" }).success).toBe(false);
  });
});

describe("PT packages", () => {
  const pkg = { sessionsTotal: 10, startsOn: "2026-10-01", expiresOn: "2026-12-29", cancelledAt: null };

  it("knows what's left and where a package stands", () => {
    expect(packageState(pkg, 3, "2026-10-20")).toEqual({ state: "active", remaining: 7 });
    expect(packageState(pkg, 10, "2026-10-20")).toEqual({ state: "used_up", remaining: 0 });
    expect(packageState(pkg, 3, "2026-12-30")).toEqual({ state: "expired", remaining: 0 });
    expect(packageState(pkg, 0, "2026-09-30")).toEqual({ state: "upcoming", remaining: 10 });
    expect(packageState({ ...pkg, cancelledAt: new Date() }, 0, "2026-10-20")).toEqual({ state: "cancelled", remaining: 0 });
  });

  it("uses the package ending soonest that covers the day and the trainer", () => {
    const list = [
      { ...pkg, id: "long", trainerId: null, expiresOn: "2027-03-01" },
      { ...pkg, id: "short", trainerId: null, expiresOn: "2026-11-15" },
      { ...pkg, id: "tara-only", trainerId: "tara", expiresOn: "2026-11-01" },
      { ...pkg, id: "cancelled", trainerId: null, expiresOn: "2026-10-25", cancelledAt: "2026-10-02" },
    ];
    const none = new Map<string, number>();
    expect(pickPackage(list, none, "2026-10-20", "tara")?.id).toBe("tara-only");
    expect(pickPackage(list, none, "2026-10-20", "tom")?.id).toBe("short");
    expect(pickPackage(list, new Map([["short", 10]]), "2026-10-20", "tom")?.id).toBe("long");
    expect(pickPackage(list, none, "2026-11-20", "tom")?.id).toBe("long"); // "short" has ended by then
    expect(pickPackage(list, none, "2026-09-01", "tom")).toBeNull(); // before any starts
  });

  it("words low-credit and expiry alerts", () => {
    expect(ptCreditsLowMemberText("10 sessions", 1)).toEqual({ title: "PT package almost used", body: "You have 1 PT session left on 10 sessions. Ask at the front desk to renew." });
    expect(ptCreditsLowMemberText("10 sessions", 0).title).toBe("PT package used up");
    expect(ptPackageExpiringText("10 sessions", 3, "29 Dec 2026").body).toBe("3 PT sessions left on 10 sessions, which ends on 29 Dec 2026. Book them before they expire.");
  });

  it("validates the catalog and the sale forms", () => {
    expect(ptPackageSchema.parse({ name: "10 sessions", description: "", sessionCount: "10", price: "12000", validityDays: "90", isActive: true })).toMatchObject({ sessionCount: 10, price: 1_200_000, description: null });
    expect(ptPackageSchema.safeParse({ name: "x", description: "", sessionCount: "0", price: "1", validityDays: "90", isActive: true }).success).toBe(false);
    const sale = { memberId: "m", packageId: "p", trainerId: "", startsOn: "2026-10-20", payNow: "partial", amount: "", method: "CASH", reference: "" };
    expect(sellPtPackageSchema.safeParse(sale).success).toBe(false); // part payment needs an amount
    expect(sellPtPackageSchema.parse({ ...sale, amount: "500" })).toMatchObject({ amountMinor: 50_000, trainerId: null });
    expect(sellPtPackageSchema.safeParse({ ...sale, payNow: "full", method: "TRANSFER" }).success).toBe(false); // transfers need a reference
  });
});
