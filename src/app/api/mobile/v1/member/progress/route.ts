import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberProgress, saveProgress } from "@/server/services/fitness/progress";

export const GET = mobileRoute(api.memberProgress, ({ auth }) => memberProgress(auth.member));

export const POST = mobileRoute(api.memberSaveProgress, ({ auth, body }) => saveProgress(auth.member, body));
