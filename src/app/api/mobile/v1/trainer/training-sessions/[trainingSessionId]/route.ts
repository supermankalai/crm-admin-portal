import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { updateTrainingSession } from "@/server/services/fitness/trainer";

export const PATCH = mobileRoute(api.trainerUpdateSession, ({ auth, params, body, meta }) => updateTrainingSession(auth.staff, params.trainingSessionId, body.status, meta));
