import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { requestAccountDeletion } from "@/server/services/member-profile";

export const POST = mobileRoute(api.memberRequestDeletion, ({ auth, body, meta }) => requestAccountDeletion(auth.member, body.reason, meta));
