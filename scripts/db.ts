/**
 * Database operations runner (owner role only).
 *
 *   tsx scripts/db.ts setup-roles   create gym_app role + test database (idempotent)
 *   tsx scripts/db.ts grants        apply prisma/sql/002_grants.sql
 *   tsx scripts/db.ts migrate       prisma migrate deploy + grants
 *   tsx scripts/db.ts reset         drop schema, run migrations (incl. RLS), grants, seed
 *
 * Add --test to target TEST_MIGRATION_DATABASE_URL instead of MIGRATION_DATABASE_URL.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { Client, escapeIdentifier, escapeLiteral } from "pg";

loadEnvConfig(process.cwd());

const [command, ...flags] = process.argv.slice(2);
const isTest = flags.includes("--test");

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✖ ${name} is not set. See .env.example.`);
    process.exit(1);
  }
  return value;
}

function ownerUrl(test = isTest) {
  return required(test ? "TEST_MIGRATION_DATABASE_URL" : "MIGRATION_DATABASE_URL");
}

function databaseName(url: string) {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/** pg does not understand Prisma's ?schema= parameter, so strip it. */
function pgConnectionString(url: string, database?: string) {
  const u = new URL(url);
  u.searchParams.delete("schema");
  if (database) u.pathname = `/${database}`;
  return u.toString();
}

async function runSql(url: string, sql: string) {
  const client = new Client({ connectionString: pgConnectionString(url) });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function ensureDatabase(url: string) {
  const name = databaseName(url);
  const client = new Client({ connectionString: pgConnectionString(url, "postgres") });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE ${escapeIdentifier(name)}`);
      console.log(`✔ created database ${name}`);
    }
  } finally {
    await client.end();
  }
}

async function setupRoles() {
  const password = required("APP_DB_PASSWORD");
  const template = readFileSync(path.join("prisma", "sql", "001_app_role.sql"), "utf8");
  const targets = [ownerUrl(false), process.env.TEST_MIGRATION_DATABASE_URL].filter(Boolean) as string[];
  for (const url of targets) {
    await ensureDatabase(url);
    const sql = template
      .replaceAll("{{APP_PASSWORD}}", escapeLiteral(password))
      .replaceAll("{{DATABASE}}", escapeIdentifier(databaseName(url)));
    await runSql(url, sql);
    console.log(`✔ gym_app role configured for database ${databaseName(url)}`);
  }
}

async function grants(url = ownerUrl()) {
  await runSql(url, readFileSync(path.join("prisma", "sql", "002_grants.sql"), "utf8"));
  console.log(`✔ grants applied to ${databaseName(url)}`);
}

function prisma(args: string[], url = ownerUrl()) {
  const result = spawnSync(`npx prisma ${args.join(" ")}`, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, MIGRATION_DATABASE_URL: url },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
  switch (command) {
    case "setup-roles":
      return setupRoles();
    case "grants":
      return grants();
    case "migrate":
      prisma(["migrate", "deploy"]);
      return grants();
    case "reset":
      if (!isTest && process.env.NODE_ENV === "production") {
        throw new Error("Refusing to reset a production database.");
      }
      prisma(["migrate", "reset", "--force"]);
      await grants();
      prisma(["db", "seed"]);
      return;
    default:
      console.error("Usage: tsx scripts/db.ts <setup-roles|grants|migrate|reset> [--test]");
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("✖", error instanceof Error ? error.message : error);
  process.exit(1);
});
