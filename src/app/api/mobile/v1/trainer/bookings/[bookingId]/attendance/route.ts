import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { trainerAttendance } from "@/server/services/fitness/trainer";

export const POST = mobileRoute(api.trainerAttendance, ({ auth, params, body, meta }) => trainerAttendance(auth.staff, params.bookingId, body.attended, meta));
