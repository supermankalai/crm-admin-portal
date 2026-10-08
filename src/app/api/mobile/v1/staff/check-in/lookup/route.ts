import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { checkInLookup } from "@/server/services/staff-app";

export const POST = mobileRoute(api.staffCheckInLookup, ({ auth, body }) => checkInLookup(auth.staff, body.query));
