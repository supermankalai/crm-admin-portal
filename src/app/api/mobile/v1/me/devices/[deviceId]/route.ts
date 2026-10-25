import { api } from "@fitcrm/shared/api/contract";
import { revokeDevice } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const DELETE = mobileRoute(api.revokeDevice, ({ auth, params, meta }) => revokeDevice(auth.user.id, params.deviceId, "user_revoked", meta));
