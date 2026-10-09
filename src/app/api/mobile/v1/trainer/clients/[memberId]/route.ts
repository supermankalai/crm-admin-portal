import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { trainerClient } from "@/server/services/fitness/trainer";

export const GET = mobileRoute(api.trainerClient, ({ auth, params, meta }) => trainerClient(auth.staff, params.memberId, meta));
