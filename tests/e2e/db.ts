import { Client } from "pg";

/** Direct owner-role access to the TEST database, for arranging and asserting e2e state. */
export async function testDb<T>(fn: (client: Client, schema: string) => Promise<T>): Promise<T> {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("TEST_MIGRATION_DATABASE_URL must point at a *_test database");
  const pgUrl = new URL(url);
  pgUrl.searchParams.delete("schema");
  const client = new Client({ connectionString: pgUrl.toString() });
  await client.connect();
  try {
    await client.query("SET TimeZone = 'UTC'");
    return await fn(client, process.env.DATABASE_SCHEMA ?? "gym-admin-portal");
  } finally {
    await client.end();
  }
}
