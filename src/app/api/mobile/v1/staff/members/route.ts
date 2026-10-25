import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { staffCreateMember, staffMembers } from "@/server/services/staff-app";

export const GET = mobileRoute(api.staffMembers, ({ auth, query }) => staffMembers(auth.staff, query));

export const POST = mobileRoute(api.staffCreateMember, ({ auth, body, meta }) => staffCreateMember(auth.staff, body, meta));
