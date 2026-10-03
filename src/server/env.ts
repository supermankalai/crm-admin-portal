import { z } from "zod";

/**
 * Environment validation. Every process (Next.js server, seed, scripts, tests) reads config
 * through `getEnv()`, which validates once and fails with a readable list of problems.
 */

const base64Key32 = z
  .string()
  .min(1)
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be base64 for exactly 32 bytes");

const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => /^postgres(ql)?:\/\//.test(v), "must be a postgresql:// connection string");

/** "1:<base64>,2:<base64>" → Map(version → key) */
const encryptionKeys = z.string().transform((raw, ctx) => {
  const keys = new Map<number, Buffer>();
  for (const part of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [versionText, key] = part.split(":", 2);
    const version = Number(versionText);
    if (!Number.isInteger(version) || version < 1 || !key) {
      ctx.addIssue({ code: "custom", message: `entry "${versionText}:…" must look like "<version>:<base64 key>"` });
      return z.NEVER;
    }
    const bytes = Buffer.from(key, "base64");
    if (bytes.length !== 32) {
      ctx.addIssue({ code: "custom", message: `key version ${version} must be base64 for exactly 32 bytes` });
      return z.NEVER;
    }
    if (keys.has(version)) {
      ctx.addIssue({ code: "custom", message: `key version ${version} is listed twice` });
      return z.NEVER;
    }
    keys.set(version, bytes);
  }
  if (keys.size === 0) {
    ctx.addIssue({ code: "custom", message: "at least one key is required" });
    return z.NEVER;
  }
  return keys;
});

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url(),
    DATABASE_URL: postgresUrl,
    MIGRATION_DATABASE_URL: postgresUrl.optional(),
    DATABASE_SCHEMA: z.string().min(1).default("gym-admin-portal"),
    AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    ENCRYPTION_KEYS: encryptionKeys,
    ENCRYPTION_ACTIVE_KEY_VERSION: z.coerce.number().int().positive(),
    BLIND_INDEX_KEY: base64Key32,
    BLIND_INDEX_KEY_VERSION: z.coerce.number().int().positive().default(1),
    STORAGE_DIR: z.string().min(1).default("./storage"),
    EMAIL_PROVIDER: z.enum(["dev-outbox"]).default("dev-outbox"),
    EMAIL_FROM: z.string().min(3),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
    // Per-IP ceilings (per 15 min for login, per hour for sign-up). Raise only behind a trusted
    // proxy that sets X-Forwarded-For, or for automated test runs.
    RATE_LIMIT_LOGIN_PER_IP: z.coerce.number().int().positive().default(30),
    RATE_LIMIT_SIGNUP_PER_IP: z.coerce.number().int().positive().default(5),
    // How many reverse proxies in front of the app append to X-Forwarded-For. The client IP is
    // taken that many entries from the right; anything further left is client-supplied.
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  })
  .superRefine((env, ctx) => {
    if (!env.ENCRYPTION_KEYS.has(env.ENCRYPTION_ACTIVE_KEY_VERSION)) {
      ctx.addIssue({
        code: "custom",
        path: ["ENCRYPTION_ACTIVE_KEY_VERSION"],
        message: `no key with version ${env.ENCRYPTION_ACTIVE_KEY_VERSION} in ENCRYPTION_KEYS`,
      });
    }
    const appUser = new URL(env.DATABASE_URL).username;
    if (appUser === "postgres") {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "must use the restricted app role (gym_app), not the postgres superuser",
      });
    }
    if (env.MIGRATION_DATABASE_URL && new URL(env.MIGRATION_DATABASE_URL).username === appUser) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "must use a different role than MIGRATION_DATABASE_URL",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}\nSee .env.example.`);
    this.name = "EnvValidationError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Messages name the variable and the rule only, never the value.
    const issues = result.error.issues.map((issue) => {
      const name = issue.path.join(".") || "environment";
      const message = issue.code === "invalid_type" && issue.input === undefined ? "is required" : issue.message;
      return `${name}: ${message}`;
    });
    throw new EnvValidationError(issues);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
