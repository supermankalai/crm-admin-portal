import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/** pg does not understand Prisma's `?schema=` parameter; the schema goes to the adapter instead. */
export function stripSchemaParam(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("schema");
  return u.toString();
}

export function createPrismaClient(connectionString: string, schema: string, max = 10) {
  // Every session runs in UTC. The pg adapter sends timestamps without an offset, so a
  // non-UTC server time zone would silently shift every stored instant.
  const adapter = new PrismaPg(
    { connectionString: stripSchemaParam(connectionString), max, options: "-c TimeZone=UTC" },
    { schema }
  );
  return new PrismaClient({ adapter });
}

export type DbClient = ReturnType<typeof createPrismaClient>;
