import { loadEnvConfig } from "@next/env";
import { resetTestDatabase } from "../support/reset-test-db";

/** E2E suite: fresh schema + the standard seed (the README test accounts) in gym_saas_test. */
export default async function globalSetup() {
  loadEnvConfig(process.cwd());
  await resetTestDatabase({ seed: true });
}
