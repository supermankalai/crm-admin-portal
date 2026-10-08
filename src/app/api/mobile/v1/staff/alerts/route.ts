import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { staffAlerts } from "@/server/services/staff-app";

export const GET = mobileRoute(api.staffAlerts, ({ auth }) => staffAlerts(auth.staff));
