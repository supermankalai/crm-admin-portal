import { api } from "@fitcrm/shared/api/contract";
import { currentGymOf } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const GET = mobileRoute(api.gym, async ({ auth }) => currentGymOf(auth.kind === "staff" ? auth.staff : auth.member));
