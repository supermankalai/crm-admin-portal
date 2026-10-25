import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { getPlan, updatePlan } from "@/server/services/fitness/workouts";

export const GET = mobileRoute(api.trainerPlan, ({ auth, params }) => getPlan(auth.staff, params.planId));

export const PUT = mobileRoute(api.trainerUpdatePlan, ({ auth, params, body, meta }) => updatePlan(auth.staff, params.planId, body, meta));
