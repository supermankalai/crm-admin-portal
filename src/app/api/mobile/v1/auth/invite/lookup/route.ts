import { api } from "@fitcrm/shared/api/contract";
import { lookupMemberInvite } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const POST = mobileRoute(api.inviteLookup, ({ body, meta }) => lookupMemberInvite(body, meta));
