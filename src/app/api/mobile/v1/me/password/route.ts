import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { changePassword } from "@/server/services/account";

/** Same service as the web: verifies the current password, ends every session (web and mobile). */
export const POST = mobileRoute(api.changePassword, async ({ auth, body, meta }) => {
  await changePassword(auth.user.id, body, meta);
  return { ok: true as const };
});
