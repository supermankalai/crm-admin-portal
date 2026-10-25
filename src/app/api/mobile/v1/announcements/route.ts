import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { listAnnouncements } from "@/server/services/app-inbox";

export const GET = mobileRoute(api.announcements, ({ auth }) => listAnnouncements(auth));
