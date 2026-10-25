import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { staffClasses } from "@/server/services/staff-app";

export const GET = mobileRoute(api.staffClasses, ({ auth, query }) => staffClasses(auth.staff, query));
