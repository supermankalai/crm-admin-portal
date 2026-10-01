/**
 * Seed: `npx prisma db seed` (or `npm run db:reset`).
 *
 * Runs as the OWNER role (MIGRATION_DATABASE_URL). Safe to run repeatedly: all tables in the
 * schema are truncated first, then fresh data is inserted using a fixed faker seed.
 * Personal data goes through the same encryption module as the app (src/server/crypto).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  // Imported after the env is loaded: these modules validate configuration on first use.
  const { getEnv } = await import("@/server/env");
  const { createPrismaClient } = await import("@/server/db/create-client");
  const { hashPassword } = await import("@/server/auth/password");
  const { GYMS, PASSWORDS, PLATFORM_PLANS, SHARED_USER, SUPER_ADMIN } = await import("./seed/config");
  const { at, id, int, past } = await import("./seed/lib");
  const { seedGym } = await import("./seed/gym");

  const env = getEnv();
  if (!env.MIGRATION_DATABASE_URL) throw new Error("MIGRATION_DATABASE_URL is required to seed");
  if (env.NODE_ENV === "production") throw new Error("Refusing to seed a production database");

  const db = createPrismaClient(env.MIGRATION_DATABASE_URL, env.DATABASE_SCHEMA, 4);
  const started = Date.now();
  try {
    console.log("Clearing existing data…");
    const tables = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = ${env.DATABASE_SCHEMA} AND tablename <> '_prisma_migrations'`;
    if (tables.length) {
      const list = tables.map((t) => `"${env.DATABASE_SCHEMA}"."${t.tablename}"`).join(", ");
      // TRUNCATE is not blocked by the append-only row triggers (it is an owner-only operation).
      await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }

    console.log("Platform…");
    const plans = PLATFORM_PLANS.map((p) => ({ ...p, id: id(), currency: "INR" }));
    await db.platformPlan.createMany({ data: plans });
    const planIds = Object.fromEntries(plans.map((p) => [p.code, p.id]));

    const [superAdminHash, staffPasswordHash] = await Promise.all([
      hashPassword(PASSWORDS.superAdmin),
      hashPassword(PASSWORDS.staff),
    ]);
    const superAdminId = id();
    const sharedUserId = id();
    await db.user.createMany({
      data: [
        { id: superAdminId, email: SUPER_ADMIN.email, name: SUPER_ADMIN.name, passwordHash: superAdminHash, isSuperAdmin: true, createdAt: at(-450, 9) },
        { id: sharedUserId, email: SHARED_USER.email, name: SHARED_USER.name, passwordHash: staffPasswordHash, createdAt: at(-400, 9), lastLoginAt: past(at(-1, 8)) },
      ],
    });
    await db.platformAuditLog.createMany({
      data: Array.from({ length: 6 }, () => ({ actorUserId: superAdminId, action: "auth.login", ip: "10.0.0.5", createdAt: past(at(-int(0, 20), int(9, 18))) })),
    });

    console.log("Gyms…");
    for (const spec of GYMS) {
      await seedGym(db, spec, { planIds, staffPasswordHash, sharedUserId, superAdminId });
      await db.platformAuditLog.createMany({
        data: [{ action: "gym.signup", targetType: "Gym", targetId: spec.slug, metadata: { plan: spec.planCode }, createdAt: at(-spec.createdDaysAgo, 9) }],
      });
    }

    console.log(`\n✔ Seed complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(`  Super admin: ${SUPER_ADMIN.email} / ${PASSWORDS.superAdmin}`);
    console.log(`  All gym staff (see README for the full list): password ${PASSWORDS.staff}`);
    console.log(`  Multi-gym user: ${SHARED_USER.email} (Trainer @ iron-temple, Manager @ zen-strength)`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("✖ Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
