import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

// Load .env the same way Next.js does, so the CLI and the app see the same values.
loadEnvConfig(process.cwd());

// Prisma CLI (migrate, seed, studio) always uses the OWNER role. The running app never does.
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  throw new Error("MIGRATION_DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url },
});
