import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { getPreferences, updatePreferences } from "@/server/services/app-inbox";

export const GET = mobileRoute(api.notificationPreferences, ({ auth }) => getPreferences(auth));

export const PUT = mobileRoute(api.updateNotificationPreferences, ({ auth, body }) => updatePreferences(auth, body));
