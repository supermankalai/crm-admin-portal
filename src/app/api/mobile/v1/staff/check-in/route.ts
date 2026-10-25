import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { checkIn, checkInSetup } from "@/server/services/staff-app";

export const GET = mobileRoute(api.staffCheckInSetup, ({ auth }) => checkInSetup(auth.staff));

export const POST = mobileRoute(api.staffCheckIn, ({ auth, body, meta }) => checkIn(auth.staff, body, meta));
