import { expect, test, type Page } from "@playwright/test";
import { testDb } from "./db";
import { login, loginAndLand } from "./helpers";

const SUPER_ADMIN = ["superadmin@fitcrm.example", "SuperAdmin#2026"] as const;

async function loginAsSuperAdmin(page: Page) {
  await login(page, ...SUPER_ADMIN);
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
}

async function openGym(page: Page, name: string) {
  await page.goto("/admin/gyms");
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

test.describe("super admin area", () => {
  test("shows platform-wide aggregates and is closed to gym staff", async ({ page }) => {
    await loginAsSuperAdmin(page);
    await expect(page.getByRole("heading", { name: "Platform overview" })).toBeVisible();
    await expect(page.getByText("Monthly recurring revenue")).toBeVisible();
    await expect(page.getByText("3 active").or(page.getByText(/\d+ active ·/))).toBeVisible();
    await logout(page);

    await loginAndLand(page, "owner@irontemple.example", /\/g\/iron-temple\/dashboard/);
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
  });

  test("lists and filters gyms with usage counts", async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto("/admin/gyms?status=TRIAL");
    await expect(page.getByRole("link", { name: "Zen Strength Collective" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Iron Temple Fitness" })).toHaveCount(0);
    await page.goto("/admin/gyms?q=pulse");
    await expect(page.getByRole("link", { name: "Pulse Fitness Studio" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /95\s*\/\s*150/ })).toBeVisible();
  });
});

test.describe("support access", () => {
  test("is explicit, read-only, audited in the gym, and ends cleanly", async ({ page }) => {
    await loginAsSuperAdmin(page);
    // Without a support session the gym is closed to the super admin.
    expect((await page.goto("/g/iron-temple/dashboard"))?.status()).toBe(404);

    await openGym(page, "Iron Temple Fitness");
    await page.getByLabel(/Reason for accessing/).fill("too short");
    await page.getByRole("button", { name: "Start support access" }).click();
    await expect(page.getByText("Give a reason of at least 10 characters")).toBeVisible();

    await page.getByLabel(/Reason for accessing/).fill("Ticket #4821 — owner reports missing check-ins");
    await page.getByRole("button", { name: "Start support access" }).click();
    await expect(page).toHaveURL(/\/g\/iron-temple\/dashboard/, { timeout: 20_000 });
    await expect(page.getByRole("alert").filter({ hasText: "Support access to Iron Temple Fitness" })).toBeVisible();
    await expect(page.getByText("Support (read-only)")).toBeVisible();

    const views = await testDb(async (db, schema) => {
      const { rows } = await db.query(
        `SELECT a.changes->>'path' AS path FROM "${schema}"."AuditLog" a JOIN "${schema}"."Gym" g ON g.id = a."gymId"
          WHERE g.slug = 'iron-temple' AND a.action = 'support.view' AND a."actorType" = 'SUPPORT'`
      );
      return rows.map((r) => r.path as string);
    });
    expect(views).toContain("/g/iron-temple/dashboard");

    await page.getByRole("button", { name: "End support session" }).click();
    await expect(page).toHaveURL(/\/admin\/gyms\//, { timeout: 20_000 });
    expect((await page.goto("/g/iron-temple/dashboard"))?.status()).toBe(404);
  });
});

test.describe("subscriptions and read-only mode", () => {
  test("a suspended gym becomes read-only for its staff, and reactivation restores it", async ({ page }) => {
    await loginAsSuperAdmin(page);
    await openGym(page, "Pulse Fitness Studio");
    await page.getByRole("button", { name: "Suspend", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Reason/).fill("Payment dispute — ticket #900");
    await dialog.getByRole("button", { name: "Suspend gym" }).click();
    await expect(page.getByText("Suspend gym: done.")).toBeVisible();
    await expect(page.locator("main").getByText("Suspended").first()).toBeVisible();
    await logout(page);

    await loginAndLand(page, "owner@pulsefitness.example", /\/g\/pulse-fitness\/dashboard/);
    await expect(page.getByRole("status").filter({ hasText: "Read-only mode" })).toContainText("suspended by the platform");
    await expect(page.getByText("Members", { exact: true })).toBeVisible(); // data still visible
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();

    await loginAsSuperAdmin(page);
    await openGym(page, "Pulse Fitness Studio");
    await page.getByRole("button", { name: "Reactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByText("Reactivate gym: done.")).toBeVisible();
  });

  test("an expired trial becomes read-only with a banner, and its data is kept", async ({ page }) => {
    const shift = async (sql: "past" | "restore") =>
      testDb((db, schema) =>
        db.query(
          sql === "past"
            ? `UPDATE "${schema}"."GymSubscription" s SET "currentPeriodEnd" = now() - interval '1 hour', "trialEndsAt" = now() - interval '1 hour'
                 FROM "${schema}"."Gym" g WHERE g.id = s."gymId" AND g.slug = 'zen-strength'`
            : `UPDATE "${schema}"."GymSubscription" s SET "currentPeriodEnd" = now() + interval '9 days', "trialEndsAt" = now() + interval '9 days'
                 FROM "${schema}"."Gym" g WHERE g.id = s."gymId" AND g.slug = 'zen-strength'`
        )
      );
    await shift("past");
    try {
      await loginAndLand(page, "owner@zenstrength.example", /\/g\/zen-strength\/dashboard/);
      await expect(page.getByRole("status").filter({ hasText: "Read-only mode" })).toContainText("Your free trial has ended");
      // Data is still there, but nothing can be added.
      await page.goto("/g/zen-strength/members");
      await expect(page.locator("table tbody tr").first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Add member" })).toHaveCount(0);
      expect((await page.goto("/g/zen-strength/members/new"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: /while the gym is read-only/ })).toBeVisible();
    } finally {
      await shift("restore");
    }
  });
});

test.describe("plan limits", () => {
  test("owners see usage against limits and a clear upgrade message when full", async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto("/admin/plans");
    const maxMembers = page.locator("#STARTER-maxMembers");
    // Number inputs have no text selection; clear with Ctrl+A and retry until hydrated.
    await expect(async () => {
      await maxMembers.click();
      await maxMembers.press("Control+A");
      await maxMembers.pressSequentially("95");
      await expect(maxMembers).toHaveValue("95", { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.locator("form").filter({ has: maxMembers }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Starter plan saved.")).toBeVisible();
    await logout(page);

    try {
      await loginAndLand(page, "owner@pulsefitness.example", /\/g\/pulse-fitness\/dashboard/);
      await page.getByRole("link", { name: "Plan & billing" }).click();
      await expect(page.getByRole("heading", { name: "Plan & billing" })).toBeVisible();
      await expect(page.getByText("Your Starter plan includes up to 95 members, and you've reached it. Upgrade your plan to add more.")).toBeVisible();
      await expect(page.getByRole("meter", { name: "members used" })).toHaveAttribute("aria-valuenow", "95");
      await expect(page.getByText("CSV export")).toBeVisible();
    } finally {
      await testDb((db, schema) => db.query(`UPDATE "${schema}"."PlatformPlan" SET "maxMembers" = 150 WHERE code = 'STARTER'`));
    }
  });

  test("billing is owner-only", async ({ page }) => {
    await loginAndLand(page, "manager1@pulsefitness.example", /\/g\/pulse-fitness\/dashboard/);
    await expect(page.getByRole("link", { name: "Plan & billing" })).toHaveCount(0);
    await page.goto("/g/pulse-fitness/billing");
    await expect(page.getByRole("heading", { name: "You don't have access to billing" })).toBeVisible();
  });
});
