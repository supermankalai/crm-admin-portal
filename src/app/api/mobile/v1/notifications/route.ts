import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { listInbox } from "@/server/services/app-inbox";

export const GET = mobileRoute(api.notifications, ({ auth, query }) => listInbox(auth, query));
