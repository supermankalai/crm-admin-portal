import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberAttendance } from "@/server/services/member-app";

export const GET = mobileRoute(api.memberAttendance, ({ auth, query }) => memberAttendance(auth.member, query));
