import { expect, test, type Page } from "@playwright/test";
import { loginAndLand } from "./helpers";

const STAFF_PASSWORD = "GymStaff#2026";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("protected pages redirect to login", async ({ page }) => {
  await page.goto("/select-gym");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("validates the form on the client", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Enter your password")).toBeVisible();
});

test("rejects a wrong password with a generic message", async ({ page }) => {
  await login(page, "owner@irontemple.example", "not-the-password");
  await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password.");
  await expect(page).toHaveURL(/\/login/);
});

test("rejects an unknown email with the same message (no account enumeration)", async ({ page }) => {
  await login(page, "nobody@irontemple.example", STAFF_PASSWORD);
  await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password.");
});

test("a single-gym owner signs in straight to their gym, and signs out", async ({ page, context }) => {
  await login(page, "owner@irontemple.example", STAFF_PASSWORD);
  await expect(page).toHaveURL(/\/g\/iron-temple\/dashboard/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();

  const cookie = (await context.cookies()).find((c) => c.name.includes("authjs.session-token"));
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/g/iron-temple/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("a user in two gyms sees both, with a different role in each", async ({ page }) => {
  await login(page, "priya.nair@fitcrm.example", STAFF_PASSWORD);
  const iron = page.getByRole("link", { name: /Iron Temple Fitness/ });
  const zen = page.getByRole("link", { name: /Zen Strength Collective/ });
  await expect(iron).toContainText("Trainer");
  await expect(zen).toContainText("Manager");
  await expect(page.getByRole("link", { name: /Pulse Fitness Studio/ })).toHaveCount(0);
});

test("responses carry security headers", async ({ request }) => {
  const res = await request.get("/login");
  const headers = res.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("repeated failed logins are rate limited", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await login(page, "frontdesk1@pulsefitness.example", `wrong-${i}`);
    await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password.");
  }
  // 6th attempt — even with the right password — is blocked for this email + IP.
  await login(page, "frontdesk1@pulsefitness.example", STAFF_PASSWORD);
  await expect(page.locator("form").getByRole("alert")).toContainText("Too many sign-in attempts");
});

test("a crafted callbackUrl can't send a signed-in user to another site", async ({ page }) => {
  await loginAndLand(page, "owner@irontemple.example", /\/dashboard/);
  for (const target of ["/%09/evil.example", "//evil.example", "/%5Cevil.example"]) {
    await page.goto(`/login?callbackUrl=${target}`);
    expect(new URL(page.url()).hostname).toBe("localhost");
  }
});

test.describe("account security", () => {
  test.describe.configure({ timeout: 90_000 });

  test("changing the password signs the user out on every device", async ({ page, browser }) => {
    const email = "frontdesk2@irontemple.example";
    await loginAndLand(page, email, /\/dashboard/);
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await loginAndLand(otherPage, email, /\/dashboard/);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Account & security" }).click();
    await page.getByLabel("Current password").fill("wrong-password");
    await page.getByLabel("New password", { exact: true }).fill("Brand-New-Pass1");
    await page.getByLabel("Confirm new password").fill("Brand-New-Pass1");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "current password is incorrect" })).toBeVisible();

    await page.getByLabel("Current password").fill(STAFF_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page).toHaveURL(/\/login\?notice=password-changed/, { timeout: 20_000 });
    await expect(page.getByRole("status").filter({ hasText: "Your password was changed" })).toBeVisible();

    // The other device's session no longer works.
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login/);
    await other.close();

    await login(page, email, STAFF_PASSWORD); // the old password no longer works
    await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password.");
    await login(page, email, "Brand-New-Pass1");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  });
});
