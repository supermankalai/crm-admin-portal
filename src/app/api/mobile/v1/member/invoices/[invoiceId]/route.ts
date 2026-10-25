import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { memberInvoice } from "@/server/services/member-app";

export const GET = mobileRoute(api.memberInvoice, ({ auth, params }) => memberInvoice(auth.member, params.invoiceId));
