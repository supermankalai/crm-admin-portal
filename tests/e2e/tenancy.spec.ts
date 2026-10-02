import { expect, test } from "@playwright/test";
import { login, loginAndLand } from "./helpers";

test.describe("tenant isolation through pages and API routes", () => {
  test("a gym owner cannot open another gym's pages (404, not 403)", async ({ page }) => {
    await loginAndLand(page, "owner@pulsefitness.example", /\/g\/pulse-fitness\/dashboard/);
    const response = await page.goto("/g/iron-temple/dashboard");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByText("Iron Temple Fitness")).toHaveCount(0);
  });

  test("the context API answers only for the caller's own gym", async ({ page }) => {
    const anonymous = await page.request.get("/api/g/pulse-fitness/context");
    expect(anonymous.status()).toBe(401);

    await loginAndLand(page, "owner@pulsefitness.example", /\/g\/pulse-fitness\/dashboard/);
    const own = await page.request.get("/api/g/pulse-fitness/context");
    expect(own.status()).toBe(200);
    const body = await own.json();
    expect(body).toMatchObject({ role: "OWNER", gym: { slug: "pulse-fitness" }, plan: { code: "STARTER" } });
    expect(body.permissions).toContain("settings.manage");

    const other = await page.request.get("/api/g/iron-temple/context");
    expect(other.status()).toBe(404);
    const unknown = await page.request.get("/api/g/does-not-exist/context");
    expect(unknown.status()).toBe(404);
  });

  test("a super admin cannot casually open a gym", async ({ page }) => {
    await login(page, "superadmin@fitcrm.example", "SuperAdmin#2026");
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
    const response = await page.goto("/g/iron-temple/dashboard");
    expect(response?.status()).toBe(404);
  });
});

test.describe("roles", () => {
  test("a trainer sees a trainer's access, a front-desk user sees theirs", async ({ page }) => {
    await loginAndLand(page, "trainer1@irontemple.example", /\/g\/iron-temple\/dashboard/);
    await expect(page.getByText("What the Trainer role can do in this gym")).toBeVisible();
    await expect(page.getByText("Manage your own classes")).toBeVisible();
    await expect(page.getByText("Record payments")).toHaveCount(0);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();

    await loginAndLand(page, "frontdesk1@irontemple.example", /\/g\/iron-temple\/dashboard/);
    await expect(page.getByText("Record payments")).toBeVisible();
    await expect(page.getByText("Issue refunds")).toHaveCount(0);
  });
});

test.describe("gym switching", () => {
  test("a user in two gyms switches between them with a different role in each", async ({ page }) => {
    await loginAndLand(page, "priya.nair@fitcrm.example", /\/select-gym/);
    await page.getByRole("link", { name: /Iron Temple Fitness/ }).click();
    await expect(page).toHaveURL(/\/g\/iron-temple\/dashboard/);
    await expect(page.getByText("you are signed in as Trainer")).toBeVisible();

    await page.getByRole("button", { name: /Current gym: Iron Temple Fitness/ }).first().click();
    await page.getByRole("menuitem", { name: /Zen Strength Collective/ }).click();
    await expect(page).toHaveURL(/\/g\/zen-strength\/dashboard/);
    await expect(page.getByText("you are signed in as Manager")).toBeVisible();
    await expect(page.getByText("Issue refunds")).toBeVisible();
    // Zen Strength is on a trial: the countdown banner is shown.
    await expect(page.getByRole("status").filter({ hasText: "Free trial" })).toBeVisible();
  });
});

test.describe("gym sign-up", () => {
  test("a new owner creates a gym, chooses a plan and lands in their trial", async ({ page }) => {
    const stamp = Date.now().toString(36);
    await page.goto("/signup");
    await page.getByLabel("Gym name").fill(`Peak Performance ${stamp}`);
    await expect(page.getByLabel("Your gym's address")).toHaveValue(`peak-performance-${stamp}`);
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Your full name").fill("Meera Kapoor");
    await page.getByLabel("Email").fill(`meera.${stamp}@peak.example`);
    await page.getByLabel("Password", { exact: true }).fill("Peak-Perform1");
    await page.getByLabel("Confirm password").fill("Peak-Perform1");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByText("Pro", { exact: true }).click();
    await page.getByRole("button", { name: /Create gym/ }).click();

    await expect(page).toHaveURL(new RegExp(`/g/peak-performance-${stamp}/dashboard`), { timeout: 30_000 });
    await expect(page.getByText("you are signed in as Owner")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Free trial" })).toContainText("14 days left");
    await expect(page.getByText("Pro", { exact: true })).toBeVisible();
  });

  test("a taken address is reported on the gym step", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Gym name").fill("Another Iron Temple");
    await page.getByLabel("Your gym's address").fill("iron-temple");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Your full name").fill("Copy Cat");
    await page.getByLabel("Email").fill(`copy.${Date.now().toString(36)}@cat.example`);
    await page.getByLabel("Password", { exact: true }).fill("Copy-Cat-123");
    await page.getByLabel("Confirm password").fill("Copy-Cat-123");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /Create gym/ }).click();

    await expect(page.getByText("This address is already taken. Try another.").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Gym name")).toBeVisible(); // back on step 1
  });

  test("reserved addresses are rejected before submitting", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Gym name").fill("Admin");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("This address is reserved")).toBeVisible();
  });
});
