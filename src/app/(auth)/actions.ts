"use server";

import { recordPlatformAuditStandalone } from "@/server/audit/platform-audit";
import { signOut } from "@/server/auth";
import { getSessionUser } from "@/server/auth/session";
import { getRequestMeta } from "@/server/security/request-meta";

export async function logoutAction() {
  const user = await getSessionUser();
  if (user) {
    await recordPlatformAuditStandalone({ action: "auth.logout", actorUserId: user.id, meta: await getRequestMeta() });
  }
  await signOut({ redirectTo: "/login" });
}
