"use server";

import { revalidatePath } from "next/cache";
import { checkInLookupSchema, checkInSchema } from "@/lib/validation/payments";
import { gymAction } from "@/server/actions/gym-action";
import { getRequestMeta } from "@/server/security/request-meta";
import { checkInMember, lookupForCheckIn } from "@/server/services/checkin";

export const lookupCheckInAction = gymAction({ permission: "checkin.perform", schema: checkInLookupSchema, write: false }, (ctx, { query }) =>
  lookupForCheckIn(ctx, query)
);

export const checkInAction = gymAction({ permission: "checkin.perform", schema: checkInSchema, write: true }, async (ctx, input) => {
  const result = await checkInMember(ctx, input, await getRequestMeta());
  revalidatePath(`/g/${ctx.gym.slug}/check-in`);
  revalidatePath(`/g/${ctx.gym.slug}/dashboard`);
  return result;
});
