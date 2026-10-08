import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { staffRecordPayment } from "@/server/services/staff-app";

export const POST = mobileRoute(api.staffRecordPayment, ({ auth, body, meta }) => staffRecordPayment(auth.staff, body, meta));
