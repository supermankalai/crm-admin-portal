import { api } from "@fitcrm/shared/api/contract";
import { scopeToGym } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const POST = mobileRoute(api.selectGym, ({ auth, body }) => scopeToGym(auth.user, auth.sessionId, auth.sessionVersion, body.gymSlug));
