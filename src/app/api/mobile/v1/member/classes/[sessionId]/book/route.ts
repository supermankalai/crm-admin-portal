import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberBookClass } from "@/server/services/classes/bookings";

/** Same booking service as the front desk: the session lock means a class is never overbooked. */
export const POST = mobileRoute(api.memberBook, async ({ auth, params, meta }) => {
  const r = await memberBookClass(auth.member, params.sessionId, meta);
  return { bookingId: r.bookingId, status: r.status, waitlistPosition: r.waitlistPosition };
});
