import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { assignPlan } from "@/server/services/fitness/workouts";

export const POST = mobileRoute(api.trainerAssignPlan, ({ auth, params, body, meta }) => assignPlan(auth.staff, params.planId, body.memberId, meta));
