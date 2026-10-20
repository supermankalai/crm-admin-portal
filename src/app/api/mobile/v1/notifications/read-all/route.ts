import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { readAllInbox } from "@/server/services/app-inbox";

export const POST = mobileRoute(api.readAllNotifications, ({ auth }) => readAllInbox(auth));
