import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

loadEnvConfig(process.cwd());

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

/**
 * E2E tests run the real app against the TEST database (gym_saas_test), reset and seeded
 * by tests/e2e/global-setup.ts. Your dev database is never touched.
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 180_000,
    env: {
      APP_URL: baseURL,
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL ?? "",
    },
  },
});
