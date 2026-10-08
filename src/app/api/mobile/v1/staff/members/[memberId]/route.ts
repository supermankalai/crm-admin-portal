import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { staffMemberProfile } from "@/server/services/staff-app";

export const GET = mobileRoute(api.staffMember, ({ auth, params }) => staffMemberProfile(auth.staff, params.memberId));
