import { describe, expect, it } from "vitest";
import { addDays, ageOn, dayBounds, diffDays, isDateString, localDate, monthBounds } from "@/domain/dates";
import { formatMemberNumber, parseMemberSearch } from "@/domain/member-search";
import {
  currentMembership,
  daysRemaining,
  freezeDaysUsed,
  memberStatusOn,
  MembershipRuleError,
  membershipStateOn,
  planCancellation,
  planFreeze,
  planUnfreeze,
  type MembershipRecord,
} from "@/domain/membership";
import { minorToMajorInput, parseMajorToMinor } from "@/domain/money";
import { memberSchema } from "@/lib/validation/members";
import { membershipPlanSchema } from "@/lib/validation/plans";

const TODAY = "2026-10-02";
const m = (over: Partial<MembershipRecord> = {}): MembershipRecord => ({
  id: "m1",
  status: "ACTIVE",
  startDate: "2026-09-15",
  endDate: "2026-10-14",
  cancelledAt: null,
  freezes: [],
  ...over,
});

describe("gym-local dates", () => {
  it("uses the gym's calendar, not UTC, for 'today'", () => {
    const instant = new Date("2026-10-01T20:00:00Z"); // 01:30 on 2 Oct in India, still 1 Oct in London
    expect(localDate(instant, "Asia/Kolkata")).toBe("2026-10-02");
    expect(localDate(instant, "Europe/London")).toBe("2026-10-01");
  });

  it("computes day and month bounds in the gym time zone", () => {
    expect(dayBounds("2026-10-02", "Asia/Kolkata")).toEqual({ start: new Date("2026-10-01T18:30:00Z"), end: new Date("2026-10-02T18:30:00Z") });
    const month = monthBounds("2026-10-15", "Asia/Kolkata");
    expect(month.start.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(month.end.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(month.firstDay).toBe("2026-10-01");
  });

  it("does calendar arithmetic", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(diffDays("2026-10-02", "2026-10-09")).toBe(7);
    expect(ageOn("1990-10-03", TODAY)).toBe(35);
    expect(ageOn("1990-10-02", TODAY)).toBe(36);
    expect(isDateString("2026-02-30")).toBe(false);
  });
});

describe("membership expiry and status", () => {
  it("is active while today is within its dates", () => {
    expect(membershipStateOn(m(), TODAY)).toBe("active");
    expect(daysRemaining(m(), TODAY)).toBe(13);
  });

  it("expires the day after its end date, with no background job", () => {
    expect(membershipStateOn(m({ endDate: TODAY }), TODAY)).toBe("active");
    expect(membershipStateOn(m({ endDate: "2026-10-01" }), TODAY)).toBe("expired");
    expect(daysRemaining(m({ endDate: "2026-10-01" }), TODAY)).toBe(0);
  });

  it("is upcoming before it starts, frozen only while a freeze covers today", () => {
    expect(membershipStateOn(m({ startDate: "2026-10-05" }), TODAY)).toBe("upcoming");
    const frozen = m({ status: "FROZEN", freezes: [{ startDate: "2026-10-01", endDate: "2026-10-05" }] });
    expect(membershipStateOn(frozen, TODAY)).toBe("frozen");
    expect(membershipStateOn(frozen, "2026-10-06")).toBe("active"); // freeze over → active again
  });

  it("treats cancellations correctly", () => {
    expect(membershipStateOn(m({ status: "CANCELLED" }), TODAY)).toBe("cancelled");
    const cancelling = m({ cancelledAt: new Date(), endDate: "2026-10-09" });
    expect(membershipStateOn(cancelling, TODAY)).toBe("active");
    expect(membershipStateOn(cancelling, "2026-10-10")).toBe("cancelled");
  });

  it("summarises a member from all their memberships", () => {
    const expired = m({ id: "old", startDate: "2026-07-01", endDate: "2026-07-31" });
    expect(memberStatusOn([], TODAY)).toBe("none");
    expect(memberStatusOn([expired], TODAY)).toBe("expired");
    expect(memberStatusOn([expired, m()], TODAY)).toBe("active");
    expect(memberStatusOn([m({ freezes: [{ startDate: TODAY, endDate: TODAY }] })], TODAY)).toBe("frozen");
    expect(currentMembership([expired, m()], TODAY)?.id).toBe("m1");
  });
});

describe("freezing", () => {
  const policy = { allowFreeze: true, maxFreezeDays: 14 };

  it("freezes from today and moves the end date out by the same days", () => {
    expect(planFreeze(m(), policy, TODAY, 7)).toEqual({ freezeStart: TODAY, freezeEnd: "2026-10-08", newEndDate: "2026-10-21" });
  });

  it("enforces the plan's allowance across freezes", () => {
    const used = m({ freezes: [{ startDate: "2026-09-16", endDate: "2026-09-25" }] }); // 10 days
    expect(freezeDaysUsed(used)).toBe(10);
    expect(() => planFreeze(used, policy, TODAY, 5)).toThrow("Only 4 freeze days left on this membership.");
    expect(planFreeze(used, policy, TODAY, 4).newEndDate).toBe("2026-10-18");
  });

  it.each([
    ["the plan does not allow it", m(), { allowFreeze: false, maxFreezeDays: 0 }, /does not allow freezing/],
    ["it is already frozen", m({ freezes: [{ startDate: TODAY, endDate: "2026-10-04" }] }), policy, /already frozen/],
    ["it has expired", m({ endDate: "2026-09-30" }), policy, /Only an active membership/],
    ["it is being cancelled", m({ cancelledAt: new Date() }), policy, /being cancelled/],
  ])("refuses when %s", (_label, membership, p, error) => {
    expect(() => planFreeze(membership, p, TODAY, 3)).toThrow(error);
  });

  it("unfreezing early gives back unused days", () => {
    const frozen = m({ status: "FROZEN", endDate: "2026-10-21", freezes: [{ startDate: "2026-09-30", endDate: "2026-10-06" }] });
    const result = planUnfreeze(frozen, TODAY);
    expect(result.newFreezeEnd).toBe("2026-10-01");
    expect(result.newEndDate).toBe("2026-10-16"); // 5 unused days (2–6 Oct) returned
  });

  it("unfreezing on the first day removes the freeze entirely", () => {
    const frozen = m({ status: "FROZEN", freezes: [{ startDate: TODAY, endDate: "2026-10-04" }] });
    expect(planUnfreeze(frozen, TODAY).newFreezeEnd).toBeNull();
  });
});

describe("cancellation", () => {
  it("honours the notice period but never extends past the paid end date", () => {
    expect(planCancellation(m(), { cancellationNoticeDays: 7, cancellationFeeMinor: 50_000 }, TODAY)).toEqual({ endsImmediately: false, effectiveEnd: "2026-10-09", feeMinor: 50_000 });
    expect(planCancellation(m(), { cancellationNoticeDays: 30, cancellationFeeMinor: 0 }, TODAY).effectiveEnd).toBe("2026-10-14");
  });

  it("with no notice period, ends today", () => {
    expect(planCancellation(m(), { cancellationNoticeDays: 0, cancellationFeeMinor: 0 }, TODAY)).toMatchObject({ endsImmediately: true, effectiveEnd: TODAY });
  });

  it("a membership that has not started is cancelled immediately", () => {
    expect(planCancellation(m({ startDate: "2026-10-10", endDate: "2026-11-09" }), { cancellationNoticeDays: 7, cancellationFeeMinor: 0 }, TODAY)).toMatchObject({
      endsImmediately: true,
      effectiveEnd: "2026-10-10",
    });
  });

  it("refuses double, expired and frozen cancellations", () => {
    const p = { cancellationNoticeDays: 0, cancellationFeeMinor: 0 };
    expect(() => planCancellation(m({ cancelledAt: new Date() }), p, TODAY)).toThrow(MembershipRuleError);
    expect(() => planCancellation(m({ endDate: "2026-09-01" }), p, TODAY)).toThrow(/already ended/);
    expect(() => planCancellation(m({ freezes: [{ startDate: TODAY, endDate: TODAY }] }), p, TODAY)).toThrow(/Unfreeze/);
  });
});

describe("money input", () => {
  it.each([
    ["2500", 250_000],
    ["2,500.50", 250_050],
    ["₹ 1,999.00", 199_900],
    ["0.5", 50],
    ["0", 0],
  ])("%s → %d minor units", (input, expected) => {
    expect(parseMajorToMinor(input)).toBe(expected);
  });

  it.each(["", "abc", "-5", "1.234", "1e5"])("rejects %j", (input) => {
    expect(parseMajorToMinor(input)).toBeNull();
  });

  it("round-trips for form fields", () => {
    expect(minorToMajorInput(250_000)).toBe("2500");
    expect(minorToMajorInput(250_050)).toBe("2500.50");
    expect(parseMajorToMinor(minorToMajorInput(199_905))).toBe(199_905);
  });
});

describe("member search parsing", () => {
  it.each([
    ["M-000123", { kind: "memberNumber", value: 123 }],
    ["#42", { kind: "memberNumber", value: 42 }],
    ["98765 43210", { kind: "phone", normalised: "+919876543210" }],
    ["+91 98765-43210", { kind: "phone", normalised: "+919876543210" }],
    ["Asha@Example.com", { kind: "email", value: "asha@example.com" }],
    ["  priya   nair ", { kind: "name", tokens: ["priya", "nair"] }],
    ["", { kind: "none" }],
  ])("%j", (input, expected) => {
    expect(parseMemberSearch(input)).toEqual(expected);
  });

  it("formats member numbers", () => {
    expect(formatMemberNumber(123)).toBe("M-000123");
  });
});

describe("member and plan validation (shared by forms and server)", () => {
  const base = { firstName: "Asha", lastName: "Rao", email: "", phone: "", address: "", dateOfBirth: "", healthNotes: "", emergencyContact: { name: "", phone: "", relation: "" } };

  it("turns empty optional fields into null", () => {
    expect(memberSchema.parse(base)).toMatchObject({ email: null, phone: null, dateOfBirth: null, emergencyContact: { name: null, phone: null } });
  });

  it("validates phones, emails, dates and complete emergency contacts", () => {
    const result = memberSchema.safeParse({ ...base, email: "nope", phone: "12", dateOfBirth: "2999-01-01", emergencyContact: { name: "Ravi", phone: "", relation: "" } });
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["email", "phone", "dateOfBirth", "emergencyContact.name"]));
  });

  it("parses plan prices exactly and requires credits for class packs", () => {
    const plan = { name: "Monthly", description: "", type: "MONTHLY", price: "2,500.50", durationDays: "30", classCredits: "", allowFreeze: false, maxFreezeDays: "5", cancellationNoticeDays: "0", cancellationFee: "", isActive: true };
    expect(membershipPlanSchema.parse(plan)).toMatchObject({ price: 250_050, cancellationFee: 0, maxFreezeDays: 0, classCredits: null });
    const pack = membershipPlanSchema.safeParse({ ...plan, type: "CLASS_PACK" });
    expect(pack.success).toBe(false);
    expect(membershipPlanSchema.safeParse({ ...plan, price: "12.345" }).success).toBe(false);
  });
});
