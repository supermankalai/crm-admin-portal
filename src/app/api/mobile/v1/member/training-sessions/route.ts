import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberTrainingSessions } from "@/server/services/fitness/trainer";

export const GET = mobileRoute(api.memberTrainingSessions, ({ auth }) => memberTrainingSessions(auth.member));
