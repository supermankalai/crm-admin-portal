/**
 * Scheduled maintenance jobs. Run every few minutes from cron / Windows Task Scheduler:
 *   npm run jobs:run
 *
 * - Marks trials and subscriptions whose period ended as EXPIRED (with history).
 *   (Read-only mode does not depend on this — it is computed from dates per request —
 *   but the job keeps statuses and the platform dashboard accurate.)
 * - Removes stale rate-limit buckets.
 *
 * Runs as the OWNER role, like other operational scripts. Logs counts only.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getEnv } = await import("@/server/env");
  const { createPrismaClient } = await import("@/server/db/create-client");
  const env = getEnv();
  if (!env.MIGRATION_DATABASE_URL) throw new Error("MIGRATION_DATABASE_URL is required");
  const db = createPrismaClient(env.MIGRATION_DATABASE_URL, env.DATABASE_SCHEMA, 1);
  try {
    // The owner role has no search_path for the app schema, so qualify the function.
    const [expired] = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT "${env.DATABASE_SCHEMA}".expire_due_subscriptions() AS n`);
    const buckets = await db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86_400_000) } } });
    console.log(JSON.stringify({ job: "jobs:run", expiredSubscriptions: Number(expired.n), staleRateLimitBuckets: buckets.count, at: new Date().toISOString() }));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("✖ jobs:run failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
