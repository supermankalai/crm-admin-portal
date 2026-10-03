import { api } from "@fitcrm/shared/api/contract";
import { redeemMemberInvite } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const POST = mobileRoute(api.inviteRedeem, ({ body, meta }) => redeemMemberInvite(body, meta));
