import { loadEnvConfig } from "@next/env";
import { resetTestDatabase } from "./reset-test-db";

/** Integration suite: fresh schema from migrations; each test file creates its own fixtures. */
export default async function setup() {
  loadEnvConfig(process.cwd());
  await resetTestDatabase();
}
