import "server-only";
import {
  applySubscriptionChange,
  InvalidSubscriptionChange,
  type SubscriptionChange,
} from "@/domain/subscription-changes";
import { recordPlatformAudit } from "@/server/audit/platform-audit";
import { withPlatformAdmin, type Tx } from "@/server/db/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { BillingProvider, ChangeRequest, ChangeResult } from "./types";

/**
 * Persist a subscription change: lock the subscription row, apply the pure transition,
 * update Gym + GymSubscription, append SubscriptionHistory and the platform audit entry —
 * all in one transaction. Shared by every billing provider.
 */
export async function persistSubscriptionChange(tx: Tx, request: ChangeRequest): Promise<ChangeResult> {
  const { gymId, change, actorUserId, meta } = request;

  // Serialise concurrent changes to the same gym.
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "GymSubscription" WHERE "gymId" = ${gymId} FOR UPDATE`;
  if (!locked.length) throw new NotFoundError("This gym has no subscription.");

  const sub = await tx.gymSubscription.findUniqueOrThrow({
    where: { gymId },
    include: { gym: { select: { status: true, slug: true } }, plan: { select: { code: true } } },
  });

  let resolved: SubscriptionChange;
  if (change.type === "changePlan") {
    const plan = await tx.platformPlan.findUnique({ where: { code: change.planCode }, select: { id: true, isActive: true } });
    if (!plan?.isActive) throw new ValidationError("Choose an active plan.", { planCode: ["Choose an active plan."] });
    resolved = { type: "changePlan", planId: plan.id };
  } else {
    resolved = change;
  }

  let result: ReturnType<typeof applySubscriptionChange>;
  try {
    result = applySubscriptionChange(
      {
        gymStatus: sub.gym.status,
        status: sub.status,
        planId: sub.planId,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        trialEndsAt: sub.trialEndsAt,
      },
      resolved
    );
  } catch (error) {
    if (error instanceof InvalidSubscriptionChange) throw new ValidationError(error.message);
    throw error;
  }
  const { next, action } = result;

  await tx.gym.update({ where: { id: gymId }, data: { status: next.gymStatus }, select: { id: true } });
  const updated = await tx.gymSubscription.update({
    where: { gymId },
    data: {
      status: next.status,
      planId: next.planId,
      currentPeriodStart: next.currentPeriodStart,
      currentPeriodEnd: next.currentPeriodEnd,
      trialEndsAt: next.trialEndsAt,
    },
    select: { plan: { select: { code: true } } },
  });

  const note = "reason" in change ? change.reason : null;
  await tx.subscriptionHistory.createMany({
    data: [
      {
        gymId,
        action,
        fromPlanId: sub.planId,
        toPlanId: next.planId,
        fromStatus: sub.status,
        toStatus: next.status,
        previousPeriodEnd: sub.currentPeriodEnd,
        newPeriodEnd: next.currentPeriodEnd,
        actorUserId,
        note,
      },
    ],
  });
  await recordPlatformAudit(tx, {
    action: `subscription.${change.type}`,
    actorUserId,
    gymId,
    targetType: "Gym",
    targetId: gymId,
    metadata: {
      slug: sub.gym.slug,
      from: { gymStatus: sub.gym.status, status: sub.status, plan: sub.plan.code, periodEnd: sub.currentPeriodEnd },
      to: { gymStatus: next.gymStatus, status: next.status, plan: updated.plan.code, periodEnd: next.currentPeriodEnd },
      note,
    },
    meta,
  });

  return { action, gymStatus: next.gymStatus, status: next.status, currentPeriodEnd: next.currentPeriodEnd, planCode: updated.plan.code };
}

export const manualBillingProvider: BillingProvider = {
  kind: "MANUAL",
  changeSubscription: (request) => withPlatformAdmin(request.actorUserId, (tx) => persistSubscriptionChange(tx, request)),
};
