"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { planUpdateSchema, subscriptionChangeSchema, supportStartSchema } from "@/lib/validation/platform";
import { platformAction } from "@/server/actions/platform-action";
import { getBillingProvider, type RequestedChange } from "@/server/billing";
import { expireDueSubscriptions, updatePlan } from "@/server/platform/services";
import { getRequestMeta } from "@/server/security/request-meta";
import { clearSupportCookie, readSupportCookie, setSupportCookie } from "@/server/support/cookie";
import { endSupportSession, startSupportSession } from "@/server/support/sessions";

export const changeSubscriptionAction = platformAction(subscriptionChangeSchema, async (admin, input) => {
  const { gymId, ...change } = input;
  const result = await getBillingProvider().changeSubscription({
    actorUserId: admin.id,
    gymId,
    change: change as RequestedChange,
    meta: await getRequestMeta(),
  });
  revalidatePath(`/admin/gyms/${gymId}`);
  revalidatePath("/admin/gyms");
  return { ...result, currentPeriodEnd: result.currentPeriodEnd.toISOString() };
});

export const updatePlanAction = platformAction(planUpdateSchema, async (admin, input) => {
  await updatePlan(admin.id, input, await getRequestMeta());
  revalidatePath("/admin/plans");
  return { code: input.code };
});

export const runExpiryAction = platformAction(z.object({}), async (admin) => {
  const expired = await expireDueSubscriptions(admin.id);
  revalidatePath("/admin");
  revalidatePath("/admin/gyms");
  return { expired };
});

export const startSupportAction = platformAction(supportStartSchema, async (admin, input) => {
  const { sessionId, slug } = await startSupportSession(admin.id, input.gymId, input.reason, await getRequestMeta());
  await setSupportCookie(sessionId);
  redirect(`/g/${slug}/dashboard`);
});

export const endSupportAction = platformAction(z.object({ sessionId: z.string().min(1).max(64).optional() }), async (admin, input) => {
  const sessionId = input.sessionId ?? (await readSupportCookie());
  const ended = sessionId ? await endSupportSession(admin.id, sessionId, await getRequestMeta()) : null;
  if (!input.sessionId || input.sessionId === (await readSupportCookie())) await clearSupportCookie();
  revalidatePath("/admin/support");
  if (!input.sessionId) redirect(ended ? `/admin/gyms/${ended.gymId}` : "/admin");
  return { ended: !!ended };
});
