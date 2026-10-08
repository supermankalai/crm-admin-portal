import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { staffPlans } from "@/server/services/staff-app";

export const GET = mobileRoute(api.staffPlans, ({ auth }) => staffPlans(auth.staff));
