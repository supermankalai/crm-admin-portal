import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { createTrainingSession } from "@/server/services/fitness/trainer";

export const POST = mobileRoute(api.trainerCreateSession, ({ auth, body, meta }) => createTrainingSession(auth.staff, body, meta));
