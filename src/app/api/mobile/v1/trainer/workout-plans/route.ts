import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { createPlan, listPlans } from "@/server/services/fitness/workouts";

export const GET = mobileRoute(api.trainerPlans, ({ auth }) => listPlans(auth.staff));

export const POST = mobileRoute(api.trainerCreatePlan, ({ auth, body, meta }) => createPlan(auth.staff, body, meta));
