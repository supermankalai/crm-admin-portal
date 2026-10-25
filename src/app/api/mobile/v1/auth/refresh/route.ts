import { api } from "@fitcrm/shared/api/contract";
import { refreshSession } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const POST = mobileRoute(api.refresh, ({ body, meta }) => refreshSession(body, meta));
