import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { staffDashboard } from "@/server/services/staff-app";

export const GET = mobileRoute(api.staffDashboard, ({ auth }) => staffDashboard(auth.staff));
