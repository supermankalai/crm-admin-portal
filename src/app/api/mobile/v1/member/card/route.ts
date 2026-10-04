import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberCard } from "@/server/services/member-app";

export const GET = mobileRoute(api.memberCard, ({ auth }) => memberCard(auth.member));
