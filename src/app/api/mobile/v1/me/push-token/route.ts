import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { registerPushToken, removePushToken } from "@/server/services/app-inbox";

export const POST = mobileRoute(api.registerPushToken, ({ auth, body }) => registerPushToken(auth, body));

export const DELETE = mobileRoute(api.removePushToken, ({ auth }) => removePushToken(auth));
