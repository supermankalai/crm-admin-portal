import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { addDays, fromDateString, toDateString } from "@/domain/dates";
import { priceMembershipSale, renewalStartDate } from "@/domain/billing";
import { membershipStateOn } from "@/domain/membership";
import { recordAudit } from "@/server/audit/tenant-audit";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import type { SellMembershipInput } from "@/lib/validation/payments";
import { todayFor, visibilityWhere } from "../members/shared";
import { nextInvoiceNumber, payAtSale } from "./shared";

/** Default start for a new sale: today, or the day after the member's current membership ends. */
export async function suggestedStartDate(ctx: TenantContext, memberId: string) {
  const today = todayFor(ctx);
  return inTenant(ctx, async (tx) => {
    const latest = await tx.membership.findFirst({
      where: { memberId, status: { in: ["ACTIVE", "FROZEN"] }, endDate: { gte: fromDateString(today) } },
      orderBy: { endDate: "desc" },
      select: { endDate: true },
    });
    return renewalStartDate(today, latest ? toDateString(latest.endDate) : null);
  });
}

/**
 * Sell a membership: membership + invoice (+ optional payment) in ONE transaction, so a member
 * never ends up with an active membership and no invoice, or a payment without its membership.
 */
export async function sellMembership(ctx: TenantContext, input: SellMembershipInput, meta: RequestMeta) {
  assertCan(ctx, "payments.record");
  if (!ctx.staffId) throw new ValidationError("Only staff can sell memberships.");
  const staffId = ctx.staffId;
  const today = todayFor(ctx);
  if (input.startDate < addDays(today, -7) || input.startDate > addDays(today, 90)) {
    throw new ValidationError("Choose a start date between a week ago and 90 days from now.", { startDate: ["Start date out of range"] });
  }

  return inTenant(ctx, async (tx) => {
    const member = await tx.member.findFirst({ where: { id: input.memberId, ...visibilityWhere(ctx) }, select: { id: true, memberNumber: true } });
    if (!member) throw new NotFoundError("Member not found.");
    const plan = await tx.membershipPlan.findFirst({ where: { id: input.planId, deletedAt: null } });
    if (!plan || !plan.isActive) throw new ValidationError("Choose a plan that is on sale.", { planId: ["Choose a plan that is on sale."] });

    const sale = priceMembershipSale(plan, ctx.gym.taxRateBps, input.startDate, today);

    // No overlapping access periods: renewals start after the current membership ends.
    const existing = await tx.membership.findMany({
      where: { memberId: member.id, status: { in: ["ACTIVE", "FROZEN"] }, endDate: { gte: fromDateString(sale.startDate) } },
      include: { freezes: { select: { startDate: true, endDate: true } } },
    });
    const overlapping = existing.find((m) => {
      const rec = { ...m, startDate: toDateString(m.startDate), endDate: toDateString(m.endDate), freezes: m.freezes.map((f) => ({ startDate: toDateString(f.startDate), endDate: toDateString(f.endDate) })) };
      return membershipStateOn(rec, today) !== "cancelled" && rec.startDate <= sale.endDate && rec.endDate >= sale.startDate;
    });
    if (overlapping) {
      const next = addDays(toDateString(overlapping.endDate), 1);
      throw new ValidationError(`This overlaps the member's current membership. Start it on ${next} instead.`, { startDate: [`Start on ${next} or later`] });
    }

    const membershipId = createId();
    await tx.membership.create({
      data: {
        id: membershipId,
        gymId: ctx.gym.id,
        memberId: member.id,
        planId: plan.id,
        startDate: fromDateString(sale.startDate),
        endDate: fromDateString(sale.endDate),
        priceMinor: plan.priceMinor,
        classCreditsRemaining: sale.classCredits,
      },
      select: { id: true },
    });

    const invoiceNumber = await nextInvoiceNumber(tx, ctx);
    const invoice = await tx.invoice.create({
      data: {
        gymId: ctx.gym.id,
        number: invoiceNumber,
        description: `${plan.name} membership`,
        memberId: member.id,
        membershipId,
        currency: ctx.gym.currency,
        subtotalMinor: sale.subtotalMinor,
        taxMinor: sale.taxMinor,
        totalMinor: sale.totalMinor,
        issuedAt: new Date(),
        dueDate: fromDateString(sale.dueDate),
      },
      select: { id: true },
    });

    const paidMinor = await payAtSale(tx, ctx, staffId, { id: invoice.id, memberId: member.id, totalMinor: sale.totalMinor, dueDate: sale.dueDate }, input, meta);

    await recordAudit(tx, ctx, {
      action: "membership.sell",
      entityType: "Membership",
      entityId: membershipId,
      changes: { plan: plan.name, startDate: sale.startDate, endDate: sale.endDate, invoiceNumber, totalMinor: sale.totalMinor, paidMinor },
    }, meta);

    return { membershipId, invoiceId: invoice.id, invoiceNumber, totalMinor: sale.totalMinor, paidMinor, startDate: sale.startDate, endDate: sale.endDate };
  });
}
