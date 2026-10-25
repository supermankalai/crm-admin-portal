import { describe, expect, it } from "vitest";
import { assertBookable, bookingPlacement, canMarkAttendance, ClassRuleError, membershipForBooking, overlaps, refundsCredit, weekDays, weekStart, type BookableMembership } from "@/domain/classes";
import { localDateTime, localTime } from "@/domain/dates";
import { assertCanChangeRole, assertCanInvite, assertCanRemove, StaffRuleError } from "@/domain/staff";
import { sessionSchema } from "@/lib/validation/classes";
import { shiftSchema, staffProfileSchema } from "@/lib/validation/staff";

const DAY = "2026-10-02";
const m = (over: Partial<BookableMembership> = {}): BookableMembership => ({ id: "m1", status: "ACTIVE", startDate: "2026-09-15", endDate: "2026-10-14", cancelledAt: null, freezes: [], classCreditsRemaining: null, ...over });
const at = (iso: string) => new Date(iso);

describe("weeks and times", () => {
  it("weeks start on Monday", () => {
    expect(weekStart("2026-10-02")).toBe("2026-09-28"); // Friday → Monday
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // Sunday belongs to the same week
    expect(weekDays("2026-09-28")).toHaveLength(7);
  });

  it("converts gym-local wall-clock times to instants and back", () => {
    const start = localDateTime("2026-10-02", "18:30", "Asia/Kolkata");
    expect(start.toISOString()).toBe("2026-10-02T13:00:00.000Z");
    expect(localTime(start, "Asia/Kolkata")).toBe("18:30");
  });

  it("detects overlapping time ranges (touching is not overlapping)", () => {
    const a = { startsAt: at("2026-10-02T10:00:00Z"), endsAt: at("2026-10-02T11:00:00Z") };
    expect(overlaps(a, { startsAt: at("2026-10-02T10:30:00Z"), endsAt: at("2026-10-02T11:30:00Z") })).toBe(true);
    expect(overlaps(a, { startsAt: at("2026-10-02T11:00:00Z"), endsAt: at("2026-10-02T12:00:00Z") })).toBe(false);
  });
});

describe("booking capacity and waitlist", () => {
  it("books while spots are free, then waitlists in order", () => {
    expect(bookingPlacement(10, 9, 0)).toEqual({ status: "BOOKED", waitlistPosition: null });
    expect(bookingPlacement(10, 10, 0)).toEqual({ status: "WAITLISTED", waitlistPosition: 1 });
    expect(bookingPlacement(10, 10, 3)).toEqual({ status: "WAITLISTED", waitlistPosition: 4 });
  });

  it("only bookable classes accept bookings", () => {
    const now = at("2026-10-02T12:00:00Z");
    expect(() => assertBookable({ status: "CANCELLED", startsAt: at("2026-10-03T10:00:00Z"), endsAt: at("2026-10-03T11:00:00Z") }, now)).toThrow(/cancelled/);
    expect(() => assertBookable({ status: "SCHEDULED", startsAt: at("2026-10-02T10:00:00Z"), endsAt: at("2026-10-02T11:00:00Z") }, now)).toThrow(/finished/);
    expect(() => assertBookable({ status: "SCHEDULED", startsAt: at("2026-10-02T11:30:00Z"), endsAt: at("2026-10-02T12:30:00Z") }, now)).not.toThrow(); // in progress
  });
});

describe("who may book", () => {
  it("time-based memberships book without credits", () => {
    expect(membershipForBooking([m()], DAY)).toEqual({ membershipId: "m1", usesCredit: false });
  });

  it("class packs need a remaining credit", () => {
    expect(membershipForBooking([m({ classCreditsRemaining: 3 })], DAY)).toEqual({ membershipId: "m1", usesCredit: true });
    expect(() => membershipForBooking([m({ classCreditsRemaining: 0 })], DAY)).toThrow(/no classes left/);
  });

  it("prefers an unlimited membership over spending a credit", () => {
    expect(membershipForBooking([m({ id: "pack", classCreditsRemaining: 5 }), m({ id: "monthly" })], DAY).membershipId).toBe("monthly");
  });

  it("checks the membership on the CLASS date, not today", () => {
    expect(() => membershipForBooking([m({ endDate: "2026-10-05" })], "2026-10-06")).toThrow(ClassRuleError);
    expect(() => membershipForBooking([m({ freezes: [{ startDate: DAY, endDate: "2026-10-04" }] })], DAY)).toThrow(/frozen/);
    expect(() => membershipForBooking([], DAY)).toThrow(/needs an active membership/);
  });

  it("returns credits only for cancellations before the class starts", () => {
    expect(refundsCredit(at("2026-10-02T13:00:00Z"), at("2026-10-02T12:00:00Z"))).toBe(true);
    expect(refundsCredit(at("2026-10-02T13:00:00Z"), at("2026-10-02T13:05:00Z"))).toBe(false);
  });

  it("attendance is open from 30 minutes before until a day after", () => {
    const s = { startsAt: at("2026-10-02T13:00:00Z"), endsAt: at("2026-10-02T14:00:00Z") };
    expect(canMarkAttendance(s, at("2026-10-02T12:00:00Z"))).toBe(false);
    expect(canMarkAttendance(s, at("2026-10-02T12:40:00Z"))).toBe(true);
    expect(canMarkAttendance(s, at("2026-10-03T13:00:00Z"))).toBe(true);
    expect(canMarkAttendance(s, at("2026-10-03T15:00:00Z"))).toBe(false);
  });
});

describe("staff rules", () => {
  it("only owners change roles, and a gym always keeps an owner", () => {
    expect(() => assertCanChangeRole("MANAGER", { role: "TRAINER", isSelf: false }, "FRONT_DESK", 1)).toThrow(/Only the gym owner/);
    expect(() => assertCanChangeRole("OWNER", { role: "OWNER", isSelf: true }, "MANAGER", 1)).toThrow(/at least one owner/);
    expect(() => assertCanChangeRole("OWNER", { role: "OWNER", isSelf: false }, "MANAGER", 2)).not.toThrow();
    expect(() => assertCanChangeRole("OWNER", { role: "TRAINER", isSelf: false }, "TRAINER", 1)).toThrow(/already have/);
  });

  it("the last owner can't be removed", () => {
    expect(() => assertCanRemove("OWNER", { role: "OWNER", isSelf: false }, 1)).toThrow(StaffRuleError);
    expect(() => assertCanRemove("OWNER", { role: "TRAINER", isSelf: false }, 1)).not.toThrow();
    expect(() => assertCanRemove("MANAGER", { role: "TRAINER", isSelf: false }, 1)).toThrow(/Only the gym owner/);
  });

  it("managers can invite front desk and trainers only", () => {
    expect(() => assertCanInvite("MANAGER", "TRAINER")).not.toThrow();
    expect(() => assertCanInvite("MANAGER", "MANAGER")).toThrow(/front desk staff and trainers only/);
    expect(() => assertCanInvite("OWNER", "OWNER")).not.toThrow();
    expect(() => assertCanInvite("FRONT_DESK", "TRAINER")).toThrow(StaffRuleError);
  });
});

describe("form validation", () => {
  it("validates sessions and shifts", () => {
    const base = { classTypeId: "t", trainerId: "s", roomId: "r", date: DAY, startTime: "18:00", durationMinutes: "60", capacity: "15", repeatWeeks: "4" };
    expect(sessionSchema.parse(base)).toMatchObject({ durationMinutes: 60, capacity: 15, repeatWeeks: 4 });
    expect(sessionSchema.safeParse({ ...base, startTime: "25:00" }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...base, repeatWeeks: "13" }).success).toBe(false);
    expect(shiftSchema.safeParse({ staffId: "s", locationId: "l", date: DAY, start: "14:00", end: "06:00" }).success).toBe(false);
  });

  it("normalises staff profile input", () => {
    expect(staffProfileSchema.parse({ staffId: "s", title: "", bio: "", specialties: " Yoga, , Strength,Yoga ", phone: "", notes: "" })).toMatchObject({
      title: null,
      specialties: ["Yoga", "Strength"],
      phone: null,
    });
  });
});
