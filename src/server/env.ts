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
    // Mobile API: one secret, from which separate keys are derived (access tokens, one-time codes,
    // QR codes, signed file URLs). 32 random bytes, base64.
    MOBILE_SECRET: base64Key32,
    SMS_PROVIDER: z.enum(["dev-outbox", "twilio"]).default("dev-outbox"),
    TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-f]{32}$/i, "must look like AC… (34 characters)").optional(),
    TWILIO_AUTH_TOKEN: z.string().min(16).optional(),
    TWILIO_FROM: z.string().min(3).optional(),
    // Push notifications: `dev-outbox` writes each push to .dev-outbox/*.push.json; `live` sends
    // them for real — Expo tokens through Expo's push service, Firebase (FCM) tokens straight to
    // Firebase using FIREBASE_SERVICE_ACCOUNT_FILE (path to the service-account key, kept out of
    // git). `expo` is the old name for `live`. EXPO_ACCESS_TOKEN is needed only if the Expo
    // project has "enhanced push security" turned on.
    PUSH_PROVIDER: z.enum(["dev-outbox", "live", "expo"]).default("dev-outbox"),
    EXPO_ACCESS_TOKEN: z.string().min(20).optional(),
    FIREBASE_SERVICE_ACCOUNT_FILE: z.string().min(1).optional(),
    // Live sessions (online PT, live classes) on a LiveKit server: all three or none, and without
    // them the feature is off. The URL is what browsers and phones connect to (wss://; ws:// only
    // on localhost); the server API is reached at the matching https:// address. The secret signs
    // join tokens and verifies webhooks, and never leaves the server.
    LIVEKIT_URL: z
      .url()
      .refine((v) => /^wss:\/\//.test(v) || /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(v), "must be a wss:// URL (ws:// only for localhost)")
      .optional(),
    LIVEKIT_API_KEY: z.string().min(3).max(200).optional(),
    LIVEKIT_API_SECRET: z.string().min(16, "must be at least 16 characters").optional(),
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
    const livekit = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;
    if (livekit.some((key) => env[key]) && !livekit.every((key) => env[key])) {
      for (const key of livekit) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "is required when any LIVEKIT_* setting is set" });
      }
    }
    if (env.SMS_PROVIDER === "twilio") {
      for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "is required when SMS_PROVIDER=twilio" });
      }
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
