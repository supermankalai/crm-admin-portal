/**
 * Runs once when the server starts. Fails fast on bad configuration so problems surface
 * at boot, not on the first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv } = await import("./server/env");
  getEnv();

  const { assertRestrictedRole } = await import("./server/db/client");
  await assertRestrictedRole();
}
