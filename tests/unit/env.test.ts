import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "@/server/env";

const key = () => randomBytes(32).toString("base64");

const valid = () => ({
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://gym_app:pw@localhost:5432/gym_saas?schema=gym-admin-portal",
  MIGRATION_DATABASE_URL: "postgresql://postgres:pw@localhost:5432/gym_saas?schema=gym-admin-portal",
  AUTH_SECRET: "x".repeat(40),
  ENCRYPTION_KEYS: `1:${key()},2:${key()}`,
  ENCRYPTION_ACTIVE_KEY_VERSION: "2",
  BLIND_INDEX_KEY: key(),
  EMAIL_FROM: "FitCRM <no-reply@example.com>",
});

function issuesFor(env: Record<string, string | undefined>) {
  try {
    parseEnv(env);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return (error as EnvValidationError).issues;
  }
}

describe("environment validation", () => {
  it("accepts a complete configuration and parses the keyring", () => {
    const env = parseEnv(valid());
    expect(env.ENCRYPTION_KEYS.size).toBe(2);
    expect(env.DATABASE_SCHEMA).toBe("gym-admin-portal");
  });

  it("names every missing variable without printing values", () => {
    const issues = issuesFor({ ...valid(), AUTH_SECRET: undefined, DATABASE_URL: undefined });
    expect(issues).toEqual(expect.arrayContaining(["AUTH_SECRET: is required", "DATABASE_URL: is required"]));
  });

  it("rejects encryption keys that are not 32 bytes", () => {
    const issues = issuesFor({ ...valid(), ENCRYPTION_KEYS: `1:${randomBytes(16).toString("base64")}`, ENCRYPTION_ACTIVE_KEY_VERSION: "1" });
    expect(issues.join()).toMatch(/exactly 32 bytes/);
  });

  it("requires the active key version to exist", () => {
    expect(issuesFor({ ...valid(), ENCRYPTION_ACTIVE_KEY_VERSION: "3" }).join()).toMatch(/no key with version 3/);
  });

  it("refuses to run the app as the postgres superuser", () => {
    const issues = issuesFor({ ...valid(), DATABASE_URL: "postgresql://postgres:pw@localhost/gym_saas" });
    expect(issues.join()).toMatch(/restricted app role/);
  });

  it("refuses the same role for the app and migrations", () => {
    const issues = issuesFor({ ...valid(), MIGRATION_DATABASE_URL: valid().DATABASE_URL });
    expect(issues.join()).toMatch(/different role/);
  });

  it("does not leak secret values in the error message", () => {
    const secret = "short-secret";
    try {
      parseEnv({ ...valid(), AUTH_SECRET: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
