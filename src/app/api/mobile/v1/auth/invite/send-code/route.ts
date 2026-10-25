import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { sendInviteVerification } from "@/server/mobile/auth";

/** Front-desk code invites: email/text a confirmation code to the address the invite is bound to. */
export const POST = mobileRoute(api.inviteSendCode, ({ body, meta }) => sendInviteVerification(body, meta));
