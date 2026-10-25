import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberInvoices } from "@/server/services/member-app";

export const GET = mobileRoute(api.memberInvoices, ({ auth, query }) => memberInvoices(auth.member, query));
