import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { addTrainerNote } from "@/server/services/fitness/trainer";

export const POST = mobileRoute(api.trainerAddNote, ({ auth, params, body, meta }) => addTrainerNote(auth.staff, params.memberId, body.body, meta));
