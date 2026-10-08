import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { staffClass } from "@/server/services/staff-app";

export const GET = mobileRoute(api.staffClass, ({ auth, params }) => staffClass(auth.staff, params.sessionId));
