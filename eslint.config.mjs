import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "src/generated/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  {
    // Tenant isolation layer 2: features may not touch the raw Prisma client. All access goes
    // through src/server/db/context.ts, which sets the RLS session context.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/db/**", "src/generated/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/server/db/client", message: "Use withTenant/withUser/withPlatformAdmin from @/server/db/context." },
            { name: "@/server/db/create-client", message: "Only the db layer, seed and tests create Prisma clients." },
            { name: "@prisma/client", message: "Use the generated client via @/server/db/context." },
          ],
          patterns: [
            {
              group: ["@/generated/prisma/client"],
              importNames: ["PrismaClient"],
              message: "Use withTenant/withUser/withPlatformAdmin from @/server/db/context.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/instrumentation.ts"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
