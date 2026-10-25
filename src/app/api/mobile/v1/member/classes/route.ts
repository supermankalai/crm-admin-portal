import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberClasses } from "@/server/services/member-app";

export const GET = mobileRoute(api.memberClasses, ({ auth, query }) => memberClasses(auth.member, query));
