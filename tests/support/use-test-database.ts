/**
 * Integration tests exercise real app services (which use DATABASE_URL via the app's db layer).
 * Point every connection at the TEST database before any app module reads the environment.
 */
const app = process.env.TEST_DATABASE_URL;
const owner = process.env.TEST_MIGRATION_DATABASE_URL;
if (!app || !owner) throw new Error("TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL must be set");
if (!new URL(app).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point at a *_test database");

process.env.DATABASE_URL = app;
process.env.MIGRATION_DATABASE_URL = owner;
