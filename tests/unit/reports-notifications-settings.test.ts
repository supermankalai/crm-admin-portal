import { describe, expect, it } from "vitest";
import { dedupeKey, expiringText, isNearLimit, overdueText, RECIPIENT_ROLES, subscriptionText } from "@/domain/notifications";
import {
  activeHourSpan,
  busiestSlot,
  csvMoney,
  heatmapGrid,
  intensity,
  lastMonthStarts,
  MAX_REPORT_DAYS,
  monthLastDay,
  percent,
  rangeBuckets,
  resolveRange,
  retentionRates,
  revenueGrain,
  toCsv,
} from "@/domain/reports";
import { formatTaxPercent, gymProfileSchema, isTimeZone, timeZones, minutesToHHMM, openingHoursSchema, parseTaxPercent } from "@/lib/validation/settings";

const TODAY = "2026-10-02";

describe("report ranges", () => {
  it("defaults to the last 90 days ending today", () => {
    expect(resolveRange(undefined, undefined, TODAY)).toEqual({ from: "2026-07-05", to: TODAY });
  });

  it("ignores invalid dates, swaps reversed ranges and never ends after today", () => {
    expect(resolveRange("nonsense", "2026-13-01", TODAY).to).toBe(TODAY);
    expect(resolveRange("2026-09-30", "2026-09-01", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolveRange("2026-09-01", "2027-01-01", TODAY).to).toBe(TODAY);
  });

  it("caps the span at a year so every query stays bounded", () => {
    const r = resolveRange("2020-01-01", TODAY, TODAY);
    expect(r.to).toBe(TODAY);
    expect((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1).toBe(MAX_REPORT_DAYS);
  });

  it("groups short ranges by day and long ones by month, filling gaps", () => {
    expect(revenueGrain({ from: "2026-09-01", to: "2026-09-30" })).toBe("day");
    expect(revenueGrain({ from: "2026-01-01", to: TODAY })).toBe("month");
    expect(rangeBuckets({ from: "2026-09-29", to: "2026-10-02" }, "day")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(rangeBuckets({ from: "2025-11-15", to: "2026-02-03" }, "month")).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });

  it("knows month ends, including leap years", () => {
    expect(monthLastDay("2028-02-01")).toBe("2028-02-29");
    expect(monthLastDay("2026-12-01")).toBe("2026-12-31");
    expect(lastMonthStarts(TODAY, 3)).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });
});

describe("CSV export", () => {
  it("quotes commas, quotes and newlines and uses CRLF with a BOM", () => {
    const csv = toCsv(["Name", "Note"], [["Asha, K", 'said "hi"\nbye']]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe('﻿Name,Note\r\n"Asha, K","said ""hi""\nbye"\r\n');
  });

  it("neutralises spreadsheet formulas in text cells, but not in numbers", () => {
    const csv = toCsv(["a", "b", "c", "d", "e"], [["=HYPERLINK(\"http://x\")", "+1", "@SUM(A1)", "-2", -5]]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")",'+1,'@SUM(A1),'-2,-5`);
  });

  it("writes money as major units with two decimals", () => {
    expect(csvMoney(123456)).toBe("1234.56");
    expect(csvMoney(5)).toBe("0.05");
    expect(csvMoney(-1050)).toBe("-10.50");
    expect(toCsv(["n"], [[null], [undefined], [Number.NaN]])).toBe("﻿n\r\n\r\n\r\n\r\n");
  });
});

describe("attendance heatmap", () => {
  const grid = heatmapGrid([
    { isoDow: 1, hour: 6, n: 10 },
    { isoDow: 1, hour: 6, n: 2 },
    { isoDow: 7, hour: 18, n: 30 },
    { isoDow: 9, hour: 3, n: 99 }, // out of range: ignored
  ]);

  it("places counts Monday-first by hour", () => {
    expect(grid).toHaveLength(7);
    expect(grid[0][6]).toBe(12);
    expect(grid[6][18]).toBe(30);
    expect(grid.flat().reduce((s, n) => s + n, 0)).toBe(42);
  });

  it("finds the busiest slot and the hours worth showing", () => {
    expect(busiestSlot(grid)).toEqual({ day: "Sun", hour: 18, n: 30 });
    expect(busiestSlot(heatmapGrid([]))).toBeNull();
    expect(activeHourSpan(grid)).toEqual({ first: 5, last: 19 });
  });

  it("scales colour steps relative to the busiest cell", () => {
    expect(intensity(0, 30)).toBe(0);
    expect(intensity(1, 30)).toBe(1);
    expect(intensity(30, 30)).toBe(5);
    expect(intensity(16, 30)).toBe(3);
  });
});

describe("retention", () => {
  it("computes retention and churn from month snapshots", () => {
    expect(retentionRates({ month: "2026-09-01", activeAtStart: 200, retained: 180, gained: 25, activeAtEnd: 205 })).toEqual({ churned: 20, retentionRate: 90, churnRate: 10 });
    expect(retentionRates({ month: "2026-09-01", activeAtStart: 0, retained: 0, gained: 5, activeAtEnd: 5 })).toEqual({ churned: 0, retentionRate: null, churnRate: null });
    expect(percent(1, 3)).toBe(33.3);
  });
});

describe("notifications", () => {
  it("dedupe keys are per alert subject and recipient", () => {
    expect(dedupeKey("PAYMENT_OVERDUE", "inv1", "u1")).toBe("payment_overdue:inv1:u1");
    expect(dedupeKey("PAYMENT_OVERDUE", "inv1", "u1")).not.toBe(dedupeKey("PAYMENT_OVERDUE", "inv1", "u2"));
  });

  it("sends money alerts to managers and owners only", () => {
    expect(RECIPIENT_ROLES.PAYMENT_OVERDUE).not.toContain("FRONT_DESK");
    expect(RECIPIENT_ROLES.MEMBERSHIP_EXPIRING).toContain("FRONT_DESK");
    expect(RECIPIENT_ROLES.SUBSCRIPTION_EXPIRING).toEqual(["OWNER"]);
    for (const roles of Object.values(RECIPIENT_ROLES)) expect(roles).not.toContain("TRAINER");
  });

  it("words alerts clearly", () => {
    expect(expiringText("Asha K", 1).body).toBe("Asha K's membership ends in 1 day.");
    expect(expiringText("Asha K", 0).body).toBe("Asha K's membership ends today.");
    expect(overdueText("INV-000042", "Ravi S", 3).body).toBe("Invoice INV-000042 for Ravi S is 3 days overdue.");
    expect(subscriptionText("Pro", 5, true).title).toBe("Trial ending soon");
  });

  it("warns at 90% of a plan limit", () => {
    expect(isNearLimit(89, 100)).toBe(false);
    expect(isNearLimit(90, 100)).toBe(true);
    expect(isNearLimit(5, 5)).toBe(true);
    expect(isNearLimit(0, 0)).toBe(false);
  });
});

describe("settings validation", () => {
  const profile = { name: "Iron Temple", email: "", phone: "", address: "", timezone: "Asia/Kolkata", currency: "INR", taxRate: "18" };

  it("parses tax percentages to basis points", () => {
    expect(parseTaxPercent("18")).toBe(1800);
    expect(parseTaxPercent("7.5")).toBe(750);
    expect(parseTaxPercent("12.25")).toBe(1225);
    expect(parseTaxPercent("100")).toBe(10000);
    expect(parseTaxPercent("100.01")).toBeNull();
    expect(parseTaxPercent("-1")).toBeNull();
    expect(parseTaxPercent("1.234")).toBeNull();
    expect(formatTaxPercent(750)).toBe("7.5");
    expect(formatTaxPercent(1225)).toBe("12.25");
    expect(formatTaxPercent(1800)).toBe("18");
  });

  it("validates the gym profile", () => {
    expect(gymProfileSchema.parse(profile)).toMatchObject({ email: null, phone: null, address: null, taxRate: 1800 });
    expect(gymProfileSchema.safeParse({ ...profile, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(gymProfileSchema.safeParse({ ...profile, currency: "JPY" }).success).toBe(false);
    expect(gymProfileSchema.safeParse({ ...profile, email: "not-an-email" }).success).toBe(false);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Asia/Kolkata")).toBe(true); // an alias ICU doesn't list
    expect(isTimeZone("Not/AZone")).toBe(false);
    expect(timeZones("Asia/Kolkata")).toContain("Asia/Kolkata");
  });

  it("validates opening hours: one row per day, closing after opening", () => {
    const week = Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, isClosed: false, open: "06:00", close: "22:00" }));
    expect(openingHoursSchema.parse({ locationId: "l", days: week }).days[0]).toEqual({ dayOfWeek: 0, isClosed: false, openMinute: 360, closeMinute: 1320 });
    expect(openingHoursSchema.safeParse({ locationId: "l", days: week.map((d, i) => (i === 2 ? { ...d, close: "05:00" } : d)) }).success).toBe(false);
    expect(openingHoursSchema.safeParse({ locationId: "l", days: week.map((d, i) => (i === 2 ? { ...d, close: "05:00", isClosed: true } : d)) }).success).toBe(true);
    expect(openingHoursSchema.safeParse({ locationId: "l", days: week.map((d) => ({ ...d, dayOfWeek: 1 })) }).success).toBe(false);
    expect(openingHoursSchema.safeParse({ locationId: "l", days: week.slice(0, 6) }).success).toBe(false);
    expect(minutesToHHMM(1440)).toBe("24:00");
    expect(minutesToHHMM(330)).toBe("05:30");
  });
});
