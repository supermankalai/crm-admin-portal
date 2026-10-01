import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { withUser } from "@/server/db/context";
import { auth } from "./index";

export { safeRedirectPath } from "@/lib/safe-redirect";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
};

/**
 * The signed-in user, re-validated against the database on every request (cached per request).
 * Returns null when there is no session, the user no longer exists, or the session was issued
 * before the user's password was changed (sessionVersion bump).
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await withUser(userId, (tx) =>
    tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, isSuperAdmin: true, sessionVersion: true },
    })
  );
  if (!user || user.sessionVersion !== session.sv) return null;
  return { id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

