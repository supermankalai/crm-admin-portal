import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { deleteProgress } from "@/server/services/fitness/progress";

export const DELETE = mobileRoute(api.memberDeleteProgress, ({ auth, params }) => deleteProgress(auth.member, params.entryId));
