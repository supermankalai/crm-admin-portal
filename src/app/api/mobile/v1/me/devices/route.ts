import { api } from "@fitcrm/shared/api/contract";
import { listDevices } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const GET = mobileRoute(api.devices, ({ auth }) => listDevices(auth.user.id, auth.sessionId));
