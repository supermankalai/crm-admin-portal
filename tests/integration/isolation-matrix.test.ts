import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, disconnectAll, getOwnerDb } from "../support/test-db";

/**
 * Exhaustive tenant isolation: for EVERY table that holds gym data (discovered from the catalog,
 * so a new table is covered automatically), prove through the restricted app role that one gym
 * can neither read, change, delete, insert into, nor move rows into another gym — using the full
 * seed (three gyms with months of realistic data), not hand-made fixtures.
 */

const schema = process.env.DATABASE_SCHEMA ?? "gym-admin-portal";
const q = (t: string) => `"${schema}"."${t}"`;

type Gym = { id: string; slug: string; ownerUserId: string };
let gyms: Gym[];
let tenantTables: string[];
let columns: Map<string, { name: string; nullable: boolean; hasDefault: boolean }[]>;
let superAdminId: string;
let supportSessionId: string;

const A = () => gyms.find((g) => g.slug === "iron-temple")!;
const B = () => gyms.find((g) => g.slug === "pulse-fitness")!;
const ctxA = () => ({ userId: A().ownerUserId, gymId: A().id });

/** Run one statement as gym A's owner in its own transaction; return affected rows or the error. */
async function tryAsA(sql: string, ctx: Parameters<typeof asApp>[0] = ctxA()): Promise<{ rows: number } | { error: string }> {
  try {
    return { rows: await asApp(ctx, (tx) => tx.$executeRawUnsafe(sql)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// Refusals: RLS, missing grants, the gym-change trigger, append-only triggers, or a BEFORE trigger
// that can't find the referenced row from inside the wrong gym.
const REJECTED = /row-level security|permission denied|cannot be changed|append-only|plan_limit|payment_not_found/i;

/** Tables that carry a gymId but are platform-level, with their own (tested) policies. */
const PLATFORM_TABLES = ["PlatformAuditLog", "GymSubscription", "SupportAccessSession"];

beforeAll(async () => {
  const env = { ...process.env, MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL, DATABASE_URL: process.env.TEST_DATABASE_URL };
  execSync("npx tsx prisma/seed.ts", { stdio: "pipe", env });

  const db = getOwnerDb();
  const rows = await db.$queryRawUnsafe<Gym[]>(
    `SELECT g.id, g.slug, u.id AS "ownerUserId" FROM ${q("Gym")} g
       JOIN ${q("StaffMember")} s ON s."gymId" = g.id AND s.role = 'OWNER' AND s.status = 'ACTIVE'
       JOIN ${q("User")} u ON u.id = s."userId"`
  );
  gyms = rows;
  const t = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'gymId' ORDER BY table_name`,
    schema
  );
  tenantTables = t.map((r) => r.table_name).filter((n) => !PLATFORM_TABLES.includes(n));
  const cols = await db.$queryRawUnsafe<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null }[]>(
    `SELECT table_name, column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 ORDER BY ordinal_position`,
    schema
  );
  columns = new Map();
  for (const c of cols) {
    const list = columns.get(c.table_name) ?? [];
    list.push({ name: c.column_name, nullable: c.is_nullable === "YES", hasDefault: c.column_default !== null });
    columns.set(c.table_name, list);
  }
  superAdminId = (await db.user.findFirstOrThrow({ where: { isSuperAdmin: true }, select: { id: true } })).id;
  supportSessionId = (
    await db.supportAccessSession.create({ data: { gymId: A().id, superAdminId, reason: "Isolation test", expiresAt: new Date(Date.now() + 3_600_000) }, select: { id: true } })
  ).id;
}, 300_000);

afterAll(async () => {
  await disconnectAll();
});

describe("catalog: every table is protected", () => {
  it("covers all the tenant tables we expect (and finds them from the schema)", () => {
    expect(tenantTables.length).toBeGreaterThanOrEqual(24);
    for (const t of ["Member", "Payment", "Booking", "Notification", "AuditLog", "FileAsset", "StaffInvitation"]) expect(tenantTables).toContain(t);
  });

  it("every application table has row-level security enabled and forced", async () => {
    const rows = await getOwnerDb().$queryRawUnsafe<{ relname: string; enabled: boolean; forced: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`,
      schema
    );
    expect(rows.length).toBeGreaterThan(tenantTables.length);
    const unprotected = rows.filter((r) => !r.enabled || !r.forced).map((r) => r.relname);
    expect(unprotected).toEqual([]);
  });

  it("every tenant write policy is bound to the current gym", async () => {
    const policies = await getOwnerDb().$queryRawUnsafe<{ tablename: string; policyname: string; cmd: string; qual: string | null; with_check: string | null }[]>(
      `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = $1`,
      schema
    );
    for (const table of tenantTables) {
      const mine = policies.filter((p) => p.tablename === table);
      expect(mine.some((p) => p.cmd === "SELECT" || p.cmd === "ALL"), `${table} has a read policy`).toBe(true);
      for (const p of mine) {
        const text = `${p.qual ?? ""} ${p.with_check ?? ""}`;
        // Each policy must tie rows to the current gym (or be a platform-admin/own-row policy).
        expect(/app_current_gym_id\(\)|app_is_platform_admin\(\)|app_current_user_id\(\)/.test(text), `${table}.${p.policyname}`).toBe(true);
      }
    }
  });

  it("SECURITY DEFINER functions pin their search_path and aren't executable by PUBLIC", async () => {
    const fns = await getOwnerDb().$queryRawUnsafe<{ proname: string; config: string[] | null; public_exec: boolean }[]>(
      `SELECT p.proname, p.proconfig AS config, has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.prosecdef`,
      schema
    );
    expect(fns.length).toBeGreaterThan(0);
    for (const f of fns) expect(f.config?.some((c) => c.startsWith("search_path=")), `${f.proname} search_path`).toBe(true);
    // Functions the anonymous login/sign-up flow needs are deliberately granted to the app role, never PUBLIC.
    expect(fns.filter((f) => f.public_exec).map((f) => f.proname)).toEqual([]);
  });
});

describe("the seed gives every table data in both gyms", () => {
  it("so the isolation checks below are meaningful", async () => {
    const empty: string[] = [];
    for (const t of tenantTables) {
      const [{ n }] = await getOwnerDb().$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q(t)} WHERE "gymId" = $1`, B().id);
      if (n === 0) empty.push(t);
    }
    // Pulse has no pending invitations or uploads in the seed; every other table has rows.
    expect(empty.filter((t) => !["StaffInvitation", "FileAsset"].includes(t))).toEqual([]);
  });
});

describe("gym A cannot touch gym B, table by table", () => {
  it("reads: sees none of gym B's rows and exactly its own", async () => {
    const leaks: string[] = [];
    for (const t of tenantTables) {
      const [{ other, mine }] = await asApp(ctxA(), (tx) =>
        tx.$queryRawUnsafe<{ other: number; mine: number }[]>(
          `SELECT count(*) FILTER (WHERE "gymId" <> $1)::int AS other, count(*) FILTER (WHERE "gymId" = $1)::int AS mine FROM ${q(t)}`,
          A().id
        )
      );
      if (other > 0) leaks.push(`${t}: ${other}`);
      if (t !== "Notification") {
        const [{ n }] = await getOwnerDb().$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q(t)} WHERE "gymId" = $1`, A().id);
        expect(mine, `${t} own rows visible`).toBe(n);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("updates and deletes aimed at gym B affect nothing", async () => {
    const problems: string[] = [];
    for (const t of tenantTables) {
      for (const sql of [
        `UPDATE ${q(t)} SET "updatedAt" = "updatedAt" WHERE "gymId" = '${B().id}'`,
        `DELETE FROM ${q(t)} WHERE "gymId" = '${B().id}'`,
      ]) {
        const r = await tryAsA(sql);
        if ("rows" in r && r.rows !== 0) problems.push(`${t}: ${sql.split(" ")[0]} changed ${r.rows} rows`);
        if ("error" in r && !REJECTED.test(r.error)) problems.push(`${t}: unexpected error ${r.error.slice(0, 120)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("inserting a row labelled as gym B is refused", async () => {
    const problems: string[] = [];
    for (const t of tenantTables) {
      const cols = columns.get(t)!.map((c) => c.name);
      // Copy one of gym A's own rows, relabelled as gym B with a fresh id.
      const select = cols.map((c) => (c === "gymId" ? `'${B().id}'` : c === "id" ? `'iso_' || md5(random()::text)` : `"${c}"`)).join(", ");
      const sql = `INSERT INTO ${q(t)} (${cols.map((c) => `"${c}"`).join(", ")}) SELECT ${select} FROM ${q(t)} WHERE "gymId" = '${A().id}' LIMIT 1`;
      const r = await tryAsA(sql);
      if ("rows" in r && r.rows > 0) problems.push(`${t}: inserted into gym B`);
      if ("error" in r && !REJECTED.test(r.error)) problems.push(`${t}: unexpected error ${r.error.slice(0, 160)}`);
    }
    expect(problems).toEqual([]);
  });

  it("moving one of gym A's rows into gym B is refused", async () => {
    const problems: string[] = [];
    for (const t of tenantTables) {
      if (!columns.get(t)!.some((c) => c.name === "id")) continue;
      const r = await tryAsA(`UPDATE ${q(t)} SET "gymId" = '${B().id}' WHERE id = (SELECT id FROM ${q(t)} WHERE "gymId" = '${A().id}' LIMIT 1)`);
      if ("rows" in r && r.rows > 0) problems.push(`${t}: moved a row to gym B`);
      if ("error" in r && !REJECTED.test(r.error)) problems.push(`${t}: unexpected error ${r.error.slice(0, 160)}`);
    }
    expect(problems).toEqual([]);
    const [{ n }] = await getOwnerDb().$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q("Member")} WHERE "gymId" = $1 AND id LIKE 'iso_%'`, B().id);
    expect(n).toBe(0);
  });
});

describe("platform tables that mention a gym", () => {
  it("gym staff can't read other gyms' subscriptions, support sessions or the platform audit log", async () => {
    for (const t of PLATFORM_TABLES) {
      const [{ other }] = await asApp(ctxA(), (tx) => tx.$queryRawUnsafe<{ other: number }[]>(`SELECT count(*)::int AS other FROM ${q(t)} WHERE "gymId" IS DISTINCT FROM $1`, A().id));
      expect(other, t).toBe(0);
    }
    const [{ n }] = await asApp(ctxA(), (tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q("PlatformAuditLog")}`));
    expect(n).toBe(0); // append-only, readable by platform admins only
  });
});

describe("other contexts", () => {
  it("without a gym context, no tenant rows are visible at all", async () => {
    for (const t of tenantTables) {
      const [{ n }] = await asApp({ userId: A().ownerUserId }, (tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q(t)} WHERE "gymId" <> ''`));
      // A user may list their own staff rows (gym switcher) and nothing else.
      if (t === "StaffMember") expect(n).toBeLessThanOrEqual(3);
      else expect(n, t).toBe(0);
    }
  });

  it("support access can read gym A but write nothing anywhere", async () => {
    const support = { userId: superAdminId, gymId: A().id, supportSessionId };
    const [{ n }] = await asApp(support, (tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q("Member")}`));
    expect(n).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const t of tenantTables) {
      for (const sql of [`UPDATE ${q(t)} SET "updatedAt" = "updatedAt"`, `DELETE FROM ${q(t)} WHERE "gymId" = '${A().id}'`]) {
        const r = await tryAsA(sql, support);
        if ("rows" in r && r.rows !== 0) problems.push(`${t}: support changed ${r.rows} rows`);
        if ("error" in r && !REJECTED.test(r.error)) problems.push(`${t}: unexpected error ${r.error.slice(0, 120)}`);
      }
    }
    expect(problems).toEqual([]);
    // ...and sees nothing of gym B.
    const [{ other }] = await asApp(support, (tx) => tx.$queryRawUnsafe<{ other: number }[]>(`SELECT count(*)::int AS other FROM ${q("Payment")} WHERE "gymId" = $1`, B().id));
    expect(other).toBe(0);
  });
});
