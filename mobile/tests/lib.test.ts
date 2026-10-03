import { contrastRatio, onColor, safeBrand } from "@/lib/colors";
import { resolveApiUrl } from "@/lib/config";
import { homeTab, tabsFor, TABS_BY_ROLE } from "@/nav/tabs";

describe("API URL configuration", () => {
  it("allows plain HTTP only in development", () => {
    expect(resolveApiUrl("http://192.168.1.20:3000", "development")).toEqual({ ok: true, url: "http://192.168.1.20:3000" });
    expect(resolveApiUrl("http://192.168.1.20:3000", "production")).toMatchObject({ ok: false });
    expect(resolveApiUrl("http://staging.example.com", "staging")).toMatchObject({ ok: false });
    expect(resolveApiUrl("https://app.example.com/", "production")).toEqual({ ok: true, url: "https://app.example.com" });
    expect(resolveApiUrl(undefined, "development")).toMatchObject({ ok: false });
    expect(resolveApiUrl("not a url", "development")).toMatchObject({ ok: false });
  });
});

describe("tabs by role", () => {
  it("shows each role only its own screens", () => {
    expect(tabsFor("MEMBER")).toEqual(["card", "classes", "workouts", "progress", "more"]);
    expect(tabsFor("FRONT_DESK")).toEqual(["checkin", "members", "classes", "more"]);
    expect(tabsFor("TRAINER")).toEqual(["schedule", "clients", "classes", "plans", "more"]);
    expect(tabsFor("OWNER")).toContain("dashboard");
    expect(tabsFor("MEMBER")).not.toContain("members");
    expect(tabsFor("TRAINER")).not.toContain("dashboard");
    expect(tabsFor(null)).toEqual([]);
    for (const tabs of Object.values(TABS_BY_ROLE)) expect(tabs.at(-1)).toBe("more");
    expect(homeTab("FRONT_DESK")).toBe("checkin");
  });
});

describe("brand colours", () => {
  it("picks readable text on any brand colour", () => {
    for (const brand of ["#ea580c", "#2563eb", "#059669", "#fde047", "#111827"]) {
      const text = onColor(brand);
      const other = text === "#ffffff" ? "#111111" : "#ffffff";
      expect(contrastRatio(brand, text)).toBeGreaterThanOrEqual(contrastRatio(brand, other));
    }
    expect(onColor("#fde047")).toBe("#111111");
    expect(onColor("#1e3a8a")).toBe("#ffffff");
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(safeBrand("javascript:alert(1)")).toBe("#ea580c");
    expect(safeBrand("#2563EB")).toBe("#2563EB");
  });
});
