import "server-only";
import { fromDateString, toDateString } from "@/domain/dates";
import { MembershipRuleError, planCancellation, planFreeze, planUnfreeze, type MembershipRecord } from "@/domain/membership";
import { recordAudit } from "@/server/audit/tenant-audit";
import type { Tx } from "@/server/db/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { invoiceCancellationFee } from "../billing/payments";
import { nextInvoiceNumber } from "../billing/shared";
import { todayFor } from "./shared";

/** Load a membership (scoped to this gym by RLS) with its plan rules, locking it for update. */
async function loadForChange(tx: Tx, membershipId: string) {
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE id = ${membershipId} FOR UPDATE`;
  const m = await tx.membership.findUnique({
    where: { id: membershipId },
    include: {
      member: { select: { deletedAt: true } },
      plan: { select: { name: true, allowFreeze: true, maxFreezeDays: true, cancellationNoticeDays: true, cancellationFeeMinor: true } },
      freezes: { select: { id: true, startDate: true, endDate: true } },
    },
  });
  if (!m || m.member.deletedAt) throw new NotFoundError("Membership not found.");
  const record: MembershipRecord = {
    id: m.id,
    status: m.status,
    startDate: toDateString(m.startDate),
    endDate: toDateString(m.endDate),
    cancelledAt: m.cancelledAt,
    freezes: m.freezes.map((f) => ({ startDate: toDateString(f.startDate), endDate: toDateString(f.endDate) })),
  };
  return { m, record };
}

function rule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof MembershipRuleError) throw new ValidationError(error.message);
    throw error;
  }
}

export async function freezeMembership(ctx: TenantContext, membershipId: string, days: number, meta: RequestMeta) {
  assertCan(ctx, "members.edit");
  const today = todayFor(ctx);
  return inTenant(ctx, async (tx) => {
    const { m, record } = await loadForChange(tx, membershipId);
    const plan = rule(() => planFreeze(record, m.plan, today, days));
    await tx.membershipFreeze.create({
      data: { gymId: ctx.gym.id, membershipId, startDate: fromDateString(plan.freezeStart), endDate: fromDateString(plan.freezeEnd) },
      select: { id: true },
    });
    await tx.membership.update({ where: { id: membershipId }, data: { status: "FROZEN", endDate: fromDateString(plan.newEndDate) }, select: { id: true } });
    await recordAudit(tx, ctx, {
      action: "membership.freeze",
      entityType: "Membership",
      entityId: membershipId,
      changes: { days, until: plan.freezeEnd, endDate: { from: record.endDate, to: plan.newEndDate } },
    }, meta);
    return plan;
  });
}

export async function unfreezeMembership(ctx: TenantContext, membershipId: string, meta: RequestMeta) {
  assertCan(ctx, "members.edit");
  const today = todayFor(ctx);
  return inTenant(ctx, async (tx) => {
    const { m, record } = await loadForChange(tx, membershipId);
    const plan = rule(() => planUnfreeze(record, today));
    const freeze = m.freezes.find((f) => toDateString(f.startDate) === plan.freeze.startDate)!;
    if (plan.newFreezeEnd) {
      await tx.membershipFreeze.update({ where: { id: freeze.id }, data: { endDate: fromDateString(plan.newFreezeEnd) }, select: { id: true } });
    } else {
      await tx.membershipFreeze.delete({ where: { id: freeze.id }, select: { id: true } });
    }
    await tx.membership.update({ where: { id: membershipId }, data: { status: "ACTIVE", endDate: fromDateString(plan.newEndDate) }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "membership.unfreeze", entityType: "Membership", entityId: membershipId, changes: { endDate: { from: record.endDate, to: plan.newEndDate } } }, meta);
    return plan;
  });
}

/**
 * Cancel following the plan's notice period. A cancellation fee, if the plan has one, is
 * invoiced in the same transaction.
 */
export async function cancelMembership(ctx: TenantContext, membershipId: string, reason: string, meta: RequestMeta) {
  assertCan(ctx, "members.edit");
  const today = todayFor(ctx);
  return inTenant(ctx, async (tx) => {
    const { m, record } = await loadForChange(tx, membershipId);
    const plan = rule(() => planCancellation(record, m.plan, today));
    await tx.membership.update({
      where: { id: membershipId },
      data: {
        status: plan.endsImmediately ? "CANCELLED" : m.status,
        endDate: fromDateString(plan.effectiveEnd),
        cancelledAt: new Date(),
        cancelReason: reason,
      },
      select: { id: true },
    });
    const feeInvoice =
      plan.feeMinor > 0
        ? await invoiceCancellationFee(tx, ctx, { memberId: m.memberId, membershipId, planName: m.plan.name, feeMinor: plan.feeMinor, number: await nextInvoiceNumber(tx, ctx) })
        : null;
    await recordAudit(tx, ctx, {
      action: "membership.cancel",
      entityType: "Membership",
      entityId: membershipId,
      changes: { effectiveEnd: plan.effectiveEnd, immediate: plan.endsImmediately, feeMinor: plan.feeMinor, feeInvoiceId: feeInvoice?.id ?? null, endDate: { from: record.endDate, to: plan.effectiveEnd } },
    }, meta);
    return { ...plan, feeInvoiceNumber: feeInvoice?.number ?? null };
  });
}
