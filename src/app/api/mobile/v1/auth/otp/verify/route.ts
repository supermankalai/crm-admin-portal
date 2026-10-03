import { api } from "@fitcrm/shared/api/contract";
import { loginWithOtp } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const POST = mobileRoute(api.otpVerify, ({ body, meta }) => loginWithOtp(body, meta));
