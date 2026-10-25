import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberCancelBooking } from "@/server/services/classes/bookings";

export const DELETE = mobileRoute(api.memberCancelBooking, async ({ auth, params, meta }) => {
  const r = await memberCancelBooking(auth.member, params.bookingId, meta);
  return { ok: true as const, creditReturned: r.creditReturned };
});
