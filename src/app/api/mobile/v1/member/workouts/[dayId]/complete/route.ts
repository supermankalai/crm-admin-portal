import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { completeWorkout } from "@/server/services/fitness/workouts";

export const POST = mobileRoute(api.memberCompleteWorkout, ({ auth, params, body }) => completeWorkout(auth.member, params.dayId, body.note));
