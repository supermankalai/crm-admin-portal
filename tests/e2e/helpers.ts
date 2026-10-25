import { expect, type Page } from "@playwright/test";

export const STAFF_PASSWORD = "GymStaff#2026";

export async function login(page: Page, email: string, password = STAFF_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function loginAndLand(page: Page, email: string, urlPattern: RegExp) {
  await login(page, email);
  await expect(page).toHaveURL(urlPattern, { timeout: 20_000 });
}
