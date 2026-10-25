import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { createMemberAppInvite } from "@/server/services/member-app-invites";

export const POST = mobileRoute(api.createMemberInvite, ({ auth, params, body, meta }) => createMemberAppInvite(auth.staff, params.memberId, body.channel, meta));
