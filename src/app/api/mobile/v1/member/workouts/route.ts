import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberWorkouts } from "@/server/services/fitness/workouts";

export const GET = mobileRoute(api.memberWorkouts, ({ auth }) => memberWorkouts(auth.member));
