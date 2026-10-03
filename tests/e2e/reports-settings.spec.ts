import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { testDb } from "./db";
import { loginAndLand } from "./helpers";

// Multi-step flows; the dev server also compiles these routes on first visit.
test.describe.configure({ timeout: 90_000 });

test.describe("reports", () => {
  test("owner reads the reports and downloads a CSV, which is audited", async ({ page }) => {
    await loginAndLand(page, "owner@irontemple.example", /\/dashboard/);
    await page.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await expect(page.getByText("Net revenue", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Attendance", exact: true }).click();
    await expect(page.getByText("Check-ins by day and hour")).toBeVisible();
    await page.getByRole("link", { name: "Class popularity" }).click();
    await expect(page.getByText("Bookings by class")).toBeVisible();
    await page.getByRole("link", { name: "Retention & churn" }).click();
    await expect(page.getByText("Monthly retention rate")).toBeVisible();

    await page.getByRole("link", { name: "Revenue", exact: true }).click();
    await expect(page).toHaveURL(/tab=revenue/);
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", /\/reports\/revenue\?/);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^iron-temple-revenue-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await download.path())!, "utf8");
    expect(csv.startsWith("﻿Date,Invoice,Member ID,Member,Plan,Method")).toBe(true);
    expect(csv.split("\r\n").length).toBeGreaterThan(10);

    await page.getByRole("link", { name: "Audit log" }).click();
    await page.getByLabel("What").selectOption("reports");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("cell", { name: /Report export/ }).first()).toBeVisible();
  });

  test("plans without reports or CSV export show an upgrade message", async ({ page }) => {
    await loginAndLand(page, "owner@pulsefitness.example", /\/dashboard/);
    await page.goto("/g/pulse-fitness/reports");
    await expect(page.getByText("Reports isn't included in your Starter plan. Upgrade your plan to use it.")).toBeVisible();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await loginAndLand(page, "owner@zenstrength.example", /\/dashboard/);
    await page.goto("/g/zen-strength/reports");
    await expect(page.getByText("Net revenue", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect((await page.request.get("/api/g/zen-strength/reports/revenue")).status()).toBe(402);
  });

  test("front desk has no reports", async ({ page }) => {
    await loginAndLand(page, "frontdesk1@irontemple.example", /\/dashboard/);
    await expect(page.getByRole("link", { name: "Reports", exact: true })).toHaveCount(0);
    expect((await page.request.get("/api/g/iron-temple/reports/revenue")).status()).toBe(403);
  });
});

test.describe("notifications", () => {
  test("the bell shows unread alerts; marking all as read clears it", async ({ page }) => {
    await loginAndLand(page, "frontdesk1@irontemple.example", /\/dashboard/);
    const bell = page.getByRole("link", { name: /^Notifications, \d+ unread$/ });
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Notifications" })).toContainText("Membership expiring soon");
    // Front desk never gets money alerts.
    await expect(page.getByText("Payment overdue")).toHaveCount(0);

    await page.getByRole("button", { name: "Mark all as read" }).click();
    await expect(page.getByText(/notifications? marked as read/)).toBeVisible();
    await expect(page.getByText("You're all caught up")).toBeVisible();
    await expect(page.getByRole("link", { name: "Notifications", exact: true }).first()).toBeVisible();
  });
});

test.describe("settings", () => {
  test("owner changes the tax rate and opening hours; both show in the audit log", async ({ page }) => {
    await loginAndLand(page, "owner@irontemple.example", /\/dashboard/);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    const tax = page.getByLabel("Tax rate (%)");
    await expect(tax).toHaveValue("18");
    try {
      await tax.fill("12.5");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Settings saved.")).toBeVisible();

      await page.getByRole("link", { name: "Locations & hours" }).click();
      await page.getByRole("group", { name: "Opening hours for Indiranagar" }).getByLabel("Sunday closes").fill("14:00");
      await page.getByRole("button", { name: "Save hours" }).first().click(); // Indiranagar is listed first
      await expect(page.getByText("Opening hours for Indiranagar saved.")).toBeVisible();

      await page.getByRole("link", { name: "Audit log" }).click();
      await page.getByLabel("What").selectOption("settings");
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page.getByRole("cell", { name: /taxRateBps: 1800 → 1250/ })).toBeVisible();
      await expect(page.getByText("Settings hours update")).toBeVisible();
    } finally {
      await testDb((db, schema) => db.query(`UPDATE "${schema}"."Gym" SET "taxRateBps" = 1800 WHERE slug = 'iron-temple'`));
    }
  });

  test("managers can't open settings or the audit log", async ({ page }) => {
    await loginAndLand(page, "manager1@irontemple.example", /\/dashboard/);
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
    await page.goto("/g/iron-temple/settings");
    await expect(page.getByRole("heading", { name: "You don't have access to gym settings" })).toBeVisible();
    await page.goto("/g/iron-temple/audit");
    await expect(page.getByRole("heading", { name: "You don't have access to the audit log" })).toBeVisible();
  });
});
