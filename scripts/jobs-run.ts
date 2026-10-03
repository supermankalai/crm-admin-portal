/**
 * Scheduled maintenance jobs. Run every few minutes from cron / Windows Task Scheduler:
 *   npm run jobs:run
 *
 * - Marks trials and subscriptions whose period ended as EXPIRED (with history).
 *   (Read-only mode does not depend on this — it is computed from dates per request —
 *   but the job keeps statuses and the platform dashboard accurate.)
 * - Removes stale rate-limit buckets.
 * - Generates in-app alerts (expiring memberships, overdue payments, plan limits, renewals) for
 *   every active gym. Idempotent: each alert has a dedupe key, so re-runs never repeat one.
 *
 * Runs as the OWNER role, like other operational scripts. Logs counts only.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getEnv } = await import("@/server/env");
  const { createPrismaClient } = await import("@/server/db/create-client");
  const { generateGymNotifications } = await import("@/server/notifications");
  const env = getEnv();
  if (!env.MIGRATION_DATABASE_URL) throw new Error("MIGRATION_DATABASE_URL is required");
  const db = createPrismaClient(env.MIGRATION_DATABASE_URL, env.DATABASE_SCHEMA, 1);
  try {
    // The owner role has no search_path for the app schema, so qualify the function.
    const [expired] = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT "${env.DATABASE_SCHEMA}".expire_due_subscriptions() AS n`);
    const buckets = await db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86_400_000) } } });
    let notifications = 0;
    const gyms = await db.gym.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] } }, select: { id: true } });
    for (const gym of gyms) {
      // One transaction per gym, so one gym's failure doesn't block the others.
      try {
        notifications += (await db.$transaction((tx) => generateGymNotifications(tx, gym.id))).created;
      } catch (error) {
        console.error(JSON.stringify({ job: "notifications", gymId: gym.id, error: error instanceof Error ? error.message : "unknown" }));
      }
    }
    console.log(JSON.stringify({ job: "jobs:run", expiredSubscriptions: Number(expired.n), staleRateLimitBuckets: buckets.count, gyms: gyms.length, notificationsCreated: notifications, at: new Date().toISOString() }));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("✖ jobs:run failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
