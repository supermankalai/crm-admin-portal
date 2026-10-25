import { api } from "@fitcrm/shared/api/contract";
import { requestOtp } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const POST = mobileRoute(api.otpRequest, ({ body, meta }) => requestOtp(body, meta));
