import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberMembership } from "@/server/services/member-app";

export const GET = mobileRoute(api.memberMembership, ({ auth }) => memberMembership(auth.member));
