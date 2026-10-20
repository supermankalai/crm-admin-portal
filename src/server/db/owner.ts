import "server-only";
import type { DbClient } from "./create-client";

/**
 * The owner-role client that operational jobs (scripts/jobs-run.ts) create. It bypasses RLS, so
 * only job code that genuinely needs every gym's rows takes one (e.g. push delivery, which needs
 * every recipient's device tokens). Web requests never get one.
 */
export type OwnerClient = DbClient;
