import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "./create-client";

/**
 * Framework-free core of the RLS context helpers (also used by integration tests with
 * their own client). Kept separate from ./context.ts so it has no "server-only" import.
 */

export type DbContext = {
  userId?: string | null;
  gymId?: string | null;
  supportSessionId?: string | null;
  platformAdmin?: boolean;
};

export type Tx = Prisma.TransactionClient;

export type TxOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeoutMs?: number;
};

export async function runInContext<T>(
  db: DbClient,
  ctx: DbContext,
  fn: (tx: Tx) => Promise<T>,
  options: TxOptions = {}
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      // set_config(..., true) is transaction-local (equivalent to SET LOCAL) and parameterised.
      await tx.$queryRaw`
        SELECT set_config('app.current_user_id', ${ctx.userId ?? ""}, true),
               set_config('app.current_gym_id', ${ctx.gymId ?? ""}, true),
               set_config('app.support_session_id', ${ctx.supportSessionId ?? ""}, true),
               set_config('app.platform_admin', ${ctx.platformAdmin ? "on" : ""}, true)`;
      return fn(tx);
    },
    { isolationLevel: options.isolationLevel, timeout: options.timeoutMs ?? 15_000, maxWait: 5_000 }
  );
}
