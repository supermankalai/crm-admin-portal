import "server-only";
import { getEnv } from "@/server/env";
import { createPrismaClient, type DbClient } from "./create-client";

/**
 * The ONLY Prisma client the running app uses. It connects as the restricted app role
 * (DATABASE_URL), so every query is subject to Row-Level Security.
 *
 * Do not import this directly from features — use the context helpers in ./context.ts.
 */

const globalForDb = globalThis as unknown as { appDb?: DbClient };

function create(): DbClient {
  const env = getEnv();
  return createPrismaClient(env.DATABASE_URL, env.DATABASE_SCHEMA);
}

export const appDb: DbClient = globalForDb.appDb ?? create();
if (process.env.NODE_ENV !== "production") globalForDb.appDb = appDb;

/**
 * Refuse to run if DATABASE_URL points at a role that could bypass RLS.
 * Called once at server start (src/instrumentation.ts).
 */
export async function assertRestrictedRole(db: DbClient = appDb): Promise<void> {
  const rows = await db.$queryRaw<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  const role = rows[0];
  if (!role || role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `DATABASE_URL connects as "${role?.rolname ?? "unknown"}", which is a superuser or has BYPASSRLS. ` +
        "The app must use the restricted gym_app role (npm run db:setup-roles)."
    );
  }
}
