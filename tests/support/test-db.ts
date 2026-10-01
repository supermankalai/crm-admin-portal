import { createPrismaClient, type DbClient } from "@/server/db/create-client";
import { runInContext, type DbContext, type Tx } from "@/server/db/run-in-context";

/**
 * Two clients against the TEST database:
 *  - owner: fixtures and assertions that need to see everything (bypasses RLS)
 *  - app:   the restricted gym_app role, exactly as the running application connects
 */

export function testUrls() {
  const owner = process.env.TEST_MIGRATION_DATABASE_URL;
  const app = process.env.TEST_DATABASE_URL;
  if (!owner || !app) throw new Error("TEST_MIGRATION_DATABASE_URL and TEST_DATABASE_URL must be set (see .env.example)");
  for (const url of [owner, app]) {
    const name = new URL(url).pathname.slice(1);
    if (!name.endsWith("_test")) throw new Error(`Refusing to run tests against database "${name}" (must end with _test)`);
  }
  return { owner, app };
}

const schema = () => process.env.DATABASE_SCHEMA ?? "gym-admin-portal";

let ownerDb: DbClient | undefined;
let appDb: DbClient | undefined;

export function getOwnerDb() {
  ownerDb ??= createPrismaClient(testUrls().owner, schema(), 3);
  return ownerDb;
}

export function getAppDb() {
  appDb ??= createPrismaClient(testUrls().app, schema(), 5);
  return appDb;
}

export function asApp<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>) {
  return runInContext(getAppDb(), ctx, fn);
}

export async function disconnectAll() {
  await Promise.all([ownerDb?.$disconnect(), appDb?.$disconnect()]);
  ownerDb = undefined;
  appDb = undefined;
}

/** Truncate everything (owner only) so each test file starts clean. */
export async function truncateAll() {
  const db = getOwnerDb();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = ${schema()} AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${schema()}"."${t.tablename}"`).join(", ");
  if (list) await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
