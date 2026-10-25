import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { staffSell } from "@/server/services/staff-app";

export const POST = mobileRoute(api.staffSellMembership, ({ auth, body, meta }) => staffSell(auth.staff, body, meta));
