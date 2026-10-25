import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { isOverdue, outstanding } from "@/domain/billing";
import { addDays, dayBounds, fromDateString, isDateString, toDateString } from "@/domain/dates";
import { formatMemberNumber } from "@/domain/member-search";
import { NotFoundError } from "@/server/errors";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { todayFor } from "../members/shared";

export const BILLING_PAGE_SIZE = 25;

export type PaymentFilters = { from?: string; to?: string; method?: "CASH" | "CARD" | "TRANSFER"; page?: number };

/** Payments in a gym-local date range, with totals (gross, refunds, net) for the whole range. */
export async function listPayments(ctx: TenantContext, filters: PaymentFilters) {
  assertCan(ctx, "payments.view");
  const today = todayFor(ctx);
  const from = filters.from && isDateString(filters.from) ? filters.from : addDays(today, -29);
  const to = filters.to && isDateString(filters.to) && filters.to >= from ? filters.to : today;
  const range = { gte: dayBounds(from, ctx.gym.timezone).start, lt: dayBounds(to, ctx.gym.timezone).end };
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.PaymentWhereInput = { deletedAt: null, receivedAt: range, ...(filters.method ? { method: filters.method } : {}) };

  return inTenant(ctx, async (tx) => {
    const total = await tx.payment.count({ where });
    const gross = (await tx.payment.aggregate({ where: { ...where, status: { not: "VOID" } }, _sum: { amountMinor: true } }))._sum.amountMinor ?? 0;
    const refunds = (await tx.refund.aggregate({ where: { refundedAt: range }, _sum: { amountMinor: true } }))._sum.amountMinor ?? 0;
    const byMethod = await tx.payment.groupBy({ by: ["method"], where: { ...where, status: { not: "VOID" } }, _sum: { amountMinor: true } });
    const rows = await tx.payment.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * BILLING_PAGE_SIZE,
      take: BILLING_PAGE_SIZE,
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        method: true,
        status: true,
        reference: true,
        receivedAt: true,
        member: { select: { id: true, firstName: true, lastName: true, memberNumber: true } },
        invoice: { select: { id: true, number: true, description: true } },
        recordedBy: { select: { user: { select: { name: true } } } },
        refunds: { select: { amountMinor: true } },
      },
    });
    return {
      from,
      to,
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / BILLING_PAGE_SIZE)),
      totals: { grossMinor: gross, refundsMinor: refunds, netMinor: gross - refunds, byMethod: Object.fromEntries(byMethod.map((m) => [m.method, m._sum.amountMinor ?? 0])) },
      rows: rows.map((p) => ({
        ...p,
        memberName: `${p.member.firstName} ${p.member.lastName}`,
        memberNumber: formatMemberNumber(p.member.memberNumber),
        recordedBy: p.recordedBy.user.name,
        refundedMinor: p.refunds.reduce((s, r) => s + r.amountMinor, 0),
      })),
    };
  });
}

export const INVOICE_FILTERS = ["open", "overdue", "paid", "void", "all"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

export async function listInvoices(ctx: TenantContext, filters: { status?: InvoiceFilter; page?: number }) {
  assertCan(ctx, "payments.view");
  const today = fromDateString(todayFor(ctx));
  const page = Math.max(1, filters.page ?? 1);
  const status = filters.status ?? "open";
  const where: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    ...(status === "open" ? { status: "OPEN" } : status === "overdue" ? { status: "OPEN", dueDate: { lt: today } } : status === "paid" ? { status: "PAID" } : status === "void" ? { status: "VOID" } : {}),
  };
  return inTenant(ctx, async (tx) => {
    const total = await tx.invoice.count({ where });
    const outstandingSum = await tx.invoice.aggregate({ where: { ...where, status: "OPEN" }, _sum: { totalMinor: true, amountPaidMinor: true } });
    const rows = await tx.invoice.findMany({
      where,
      orderBy: status === "overdue" || status === "open" ? [{ dueDate: "asc" }, { number: "asc" }] : [{ issuedAt: "desc" }],
      skip: (page - 1) * BILLING_PAGE_SIZE,
      take: BILLING_PAGE_SIZE,
      select: {
        id: true,
        number: true,
        description: true,
        status: true,
        totalMinor: true,
        amountPaidMinor: true,
        currency: true,
        issuedAt: true,
        dueDate: true,
        member: { select: { id: true, firstName: true, lastName: true, memberNumber: true } },
      },
    });
    const todayStr = toDateString(today);
    return {
      status,
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / BILLING_PAGE_SIZE)),
      outstandingMinor: (outstandingSum._sum.totalMinor ?? 0) - (outstandingSum._sum.amountPaidMinor ?? 0),
      rows: rows.map((i) => {
        const dueDate = toDateString(i.dueDate);
        return {
          ...i,
          dueDate,
          outstandingMinor: outstanding(i),
          overdue: isOverdue({ ...i, dueDate }, todayStr),
          memberName: `${i.member.firstName} ${i.member.lastName}`,
          memberNumber: formatMemberNumber(i.member.memberNumber),
        };
      }),
    };
  });
}

export async function getInvoice(ctx: TenantContext, invoiceId: string) {
  assertCan(ctx, "payments.view");
  const today = todayFor(ctx);
  return inTenant(ctx, async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, deletedAt: null },
      include: {
        member: { select: { id: true, firstName: true, lastName: true, memberNumber: true, email: true } },
        membership: { select: { id: true, startDate: true, endDate: true, status: true, plan: { select: { name: true, type: true } } } },
        payments: {
          where: { deletedAt: null },
          orderBy: { receivedAt: "asc" },
          include: { refunds: { orderBy: { refundedAt: "asc" } }, recordedBy: { select: { user: { select: { name: true } } } } },
        },
      },
    });
    if (!invoice) throw new NotFoundError("Invoice not found.");
    const gym = await tx.gym.findUniqueOrThrow({ where: { id: ctx.gym.id }, select: { name: true, address: true, email: true, phone: true, taxRateBps: true } });
    const dueDate = toDateString(invoice.dueDate);
    return {
      invoice: { ...invoice, dueDate, outstandingMinor: outstanding(invoice), overdue: isOverdue({ ...invoice, dueDate }, today) },
      gym,
      payments: invoice.payments.map((p) => {
        const refundedMinor = p.refunds.reduce((s, r) => s + r.amountMinor, 0);
        return { ...p, refundedMinor, refundableMinor: p.status === "VOID" ? 0 : p.amountMinor - refundedMinor, recordedBy: p.recordedBy.user.name };
      }),
    };
  });
}

/** Lightweight member search for pickers (sell membership, record payment). */
export async function searchMembersForPicker(ctx: TenantContext, q: string) {
  assertCan(ctx, "members.view");
  const { listMembers } = await import("../members/list");
  const result = await listMembers(ctx, { q, sort: "name" });
  return result.rows.slice(0, 8).map((r) => ({ id: r.id, name: r.name, memberNumber: r.memberNumber, status: r.status, planName: r.planName, endDate: r.endDate }));
}
