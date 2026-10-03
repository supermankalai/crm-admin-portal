import { api } from "@fitcrm/shared/api/contract";
import { revokeDevice } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const POST = mobileRoute(api.logout, ({ auth, meta }) => revokeDevice(auth.user.id, auth.sessionId, "logout", meta));
