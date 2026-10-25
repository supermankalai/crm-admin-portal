import { api } from "@fitcrm/shared/api/contract";
import { tryDecrypt, userPhoneContext } from "@/server/crypto";
import { withUser } from "@/server/db/context";
import { gymsFor } from "@/server/mobile/auth";
import { mobileRoute } from "@/server/mobile/route";

export const GET = mobileRoute(api.me, async ({ auth }) => {
  const user = await withUser(auth.user.id, (tx) => tx.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { id: true, name: true, email: true, phoneEnc: true } }));
  return {
    user: { id: user.id, name: user.name, email: user.email, phone: tryDecrypt(user.phoneEnc, userPhoneContext(user.id)) },
    gyms: await gymsFor(user.id),
  };
});
