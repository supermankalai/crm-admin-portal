/**
 * Re-encrypt personal data with the active key and recompute blind indexes.
 *
 *   1. Add a new key:  npm run keys:generate -- --encryption-version 2  → append to ENCRYPTION_KEYS
 *   2. Set ENCRYPTION_ACTIVE_KEY_VERSION=2 and restart the app (new writes use key 2)
 *   3. Run:            npm run crypto:rotate            (add --dry-run to only count)
 *   4. When it reports 0 remaining, remove key 1 from ENCRYPTION_KEYS
 *
 * Runs as the OWNER role (a data migration, like seeding). Processes rows in batches, one
 * transaction per batch, and logs counts only — never values.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type FieldSpec = { model: "Member" | "StaffMember" | "MemberNote"; fields: string[] };

const SPECS: FieldSpec[] = [
  { model: "Member", fields: ["phoneEnc", "addressEnc", "dateOfBirthEnc", "emergencyContactEnc", "healthNotesEnc"] },
  { model: "StaffMember", fields: ["phoneEnc", "notesEnc"] },
  { model: "MemberNote", fields: ["bodyEnc"] },
];

const BATCH = 200;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { getEnv } = await import("@/server/env");
  const { createPrismaClient } = await import("@/server/db/create-client");
  const { decryptField, encryptField, isStale, phoneBlindIndex } = await import("@/server/crypto");

  const env = getEnv();
  if (!env.MIGRATION_DATABASE_URL) throw new Error("MIGRATION_DATABASE_URL is required");
  const db = createPrismaClient(env.MIGRATION_DATABASE_URL, env.DATABASE_SCHEMA, 2);
  const schema = env.DATABASE_SCHEMA;
  const blindPrefix = `${env.BLIND_INDEX_KEY_VERSION}.`;

  try {
    for (const { model, fields } of SPECS) {
      let rotated = 0;
      let remaining = 0;
      let cursor = "";
      for (;;) {
        const cols = ["id", '"gymId"', ...fields.map((f) => `"${f}"`), ...(model === "Member" ? ['"phoneBlindIndex"'] : [])];
        const rows = await db.$queryRawUnsafe<Record<string, string | null>[]>(
          `SELECT ${cols.join(", ")} FROM "${schema}"."${model}" WHERE id > $1 ORDER BY id LIMIT ${BATCH}`,
          cursor
        );
        if (!rows.length) break;
        cursor = rows[rows.length - 1].id as string;

        const updates: { id: string; set: Record<string, string> }[] = [];
        for (const row of rows) {
          const set: Record<string, string> = {};
          for (const field of fields) {
            const stored = row[field];
            if (!stored || !isStale(stored)) continue;
            const ctx = { gymId: row.gymId as string, model, field: field.replace(/Enc$/, ""), recordId: row.id as string };
            set[field] = encryptField(decryptField(stored, ctx), ctx);
          }
          if (model === "Member" && row.phoneEnc && row.phoneBlindIndex && !row.phoneBlindIndex.startsWith(blindPrefix)) {
            const ctx = { gymId: row.gymId as string, model, field: "phone", recordId: row.id as string };
            set.phoneBlindIndex = phoneBlindIndex(row.gymId as string, decryptField(row.phoneEnc, ctx)) ?? "";
          }
          if (Object.keys(set).length) updates.push({ id: row.id as string, set });
        }

        remaining += updates.length;
        if (dryRun || !updates.length) continue;
        await db.$transaction(
          updates.map(({ id, set }) => {
            const assignments = Object.keys(set).map((col, i) => `"${col}" = $${i + 2}`);
            return db.$executeRawUnsafe(
              `UPDATE "${schema}"."${model}" SET ${assignments.join(", ")} WHERE id = $1`,
              id,
              ...Object.values(set)
            );
          })
        );
        rotated += updates.length;
      }
      console.log(`${model.padEnd(12)} ${dryRun ? `${remaining} rows need rotation` : `${rotated} rows rotated`}`);
    }
    console.log(dryRun ? "Dry run complete." : "✔ Rotation complete. Re-run with --dry-run to confirm 0 remaining.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("✖ Rotation failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
