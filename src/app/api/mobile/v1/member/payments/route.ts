import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberPayments } from "@/server/services/member-app";

export const GET = mobileRoute(api.memberPayments, ({ auth, query }) => memberPayments(auth.member, query));
