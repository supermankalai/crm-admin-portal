import { api } from "@fitcrm/shared/api/contract";
import { loginWithPassword } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const POST = mobileRoute(api.login, ({ body, meta }) => loginWithPassword(body, meta));
