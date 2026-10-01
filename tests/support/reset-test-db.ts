import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Rebuild the TEST database schema from migrations: drop schema → migrate deploy → grants
 * (→ optional seed). Refuses to touch any database whose name does not end in "_test".
 */
export async function resetTestDatabase({ seed = false } = {}) {
  const owner = process.env.TEST_MIGRATION_DATABASE_URL;
  const app = process.env.TEST_DATABASE_URL;
  if (!owner || !app) throw new Error("TEST_MIGRATION_DATABASE_URL and TEST_DATABASE_URL must be set");
  for (const url of [owner, app]) {
    const name = new URL(url).pathname.slice(1);
    if (!name.endsWith("_test")) throw new Error(`Refusing to reset "${name}": test database names must end with _test`);
  }

  const schema = process.env.DATABASE_SCHEMA ?? "gym-admin-portal";
  const pgUrl = new URL(owner);
  pgUrl.searchParams.delete("schema");

  const client = new Client({ connectionString: pgUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await client.end();
  }

  const env = { ...process.env, MIGRATION_DATABASE_URL: owner, DATABASE_URL: app };
  execSync("npx prisma migrate deploy", { stdio: "pipe", env });

  const grants = new Client({ connectionString: pgUrl.toString() });
  await grants.connect();
  try {
    await grants.query(readFileSync(path.join("prisma", "sql", "002_grants.sql"), "utf8"));
  } finally {
    await grants.end();
  }

  if (seed) execSync("npx tsx prisma/seed.ts", { stdio: "pipe", env });
}
