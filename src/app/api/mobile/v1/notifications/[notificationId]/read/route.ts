import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { readInboxItem } from "@/server/services/app-inbox";

export const POST = mobileRoute(api.readNotification, ({ auth, params }) => readInboxItem(auth, params.notificationId));
