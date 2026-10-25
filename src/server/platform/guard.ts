import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getSessionUser, requireUser, type SessionUser } from "@/server/auth/session";

/**
 * Super admin area guard. isSuperAdmin is re-read from the database on every request
 * (getSessionUser), never trusted from the session token. Non-admins get a 404.
 */
export const requirePlatformAdmin = cache(async (): Promise<SessionUser> => {
  const user = await requireUser();
  if (!user.isSuperAdmin) notFound();
  return user;
});

/** For server actions and route handlers: null instead of redirecting. */
export async function getPlatformAdmin(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user?.isSuperAdmin ? user : null;
}
