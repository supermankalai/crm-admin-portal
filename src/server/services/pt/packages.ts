import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { addDays, fromDateString, toDateString } from "@/domain/dates";
import { invoiceTotals } from "@/domain/money";
import { can } from "@/domain/permissions";
import { packageState } from "@/domain/pt";
import type { PtPackageInput, SellPtPackageInput } from "@/lib/validation/pt";
import { recordAudit } from "@/server/audit/tenant-audit";
import type { Tx } from "@/server/db/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, assertWritable, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { nextInvoiceNumber, payAtSale } from "../billing/shared";
import { todayFor, visibilityWhere } from "../members/shared";

/**
 * PT packages: the catalog (owners and managers), selling one to a member (whoever takes payments:
 * owner, manager, front desk), and what a member has left. A sale is a package purchase plus its
 * invoice (and optional payment) in one transaction, so it shows up in payments and revenue
 * reports like a membership. Credits are counted from the sessions that use them, never stored.
 */

/** Sessions holding a credit: booked, done or missed. Cancelled ones gave theirs back. */
export const CREDIT_STATUSES = ["SCHEDULED", "COMPLETED", "NO_SHOW"] as const;
const PAYMENT_TERMS_DAYS = 7;

export async function creditsUsed(tx: Tx, purchaseIds: string[]) {
  if (!purchaseIds.length) return new Map<string, number>();
  const rows = await tx.trainingSession.groupBy({ by: ["purchaseId"], where: { purchaseId: { in: purchaseIds }, status: { in: [...CREDIT_STATUSES] } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.purchaseId as string, r._count._all]));
}

function canSeeCatalog(ctx: TenantContext) {
  if (!can(ctx.role, "pt.manage") && !can(ctx.role, "payments.record") && !can(ctx.role, "workouts.manage")) throw new ForbiddenError();
}

// ─────────────────────────────── Catalog ───────────────────────────────

export async function listPackages(ctx: TenantContext, opts: { activeOnly?: boolean } = {}) {
  canSeeCatalog(ctx);
  return inTenant(ctx, async (tx) => {
    const rows = await tx.ptPackage.findMany({
      where: { deletedAt: null, ...(opts.activeOnly ? { isActive: true } : {}) },
      orderBy: [{ isActive: "desc" }, { sessionCount: "asc" }, { name: "asc" }],
      select: { id: true, name: true, description: true, sessionCount: true, priceMinor: true, validityDays: true, isActive: true, _count: { select: { purchases: true } } },
    });
    return rows.map(({ _count, ...p }) => ({ ...p, sold: _count.purchases }));
  });
}

export async function savePackage(ctx: TenantContext, input: PtPackageInput, meta: RequestMeta) {
  assertCan(ctx, "pt.manage");
  assertWritable(ctx);
  const data = { name: input.name, description: input.description, sessionCount: input.sessionCount, priceMinor: input.price, validityDays: input.validityDays, isActive: input.isActive };
  return inTenant(ctx, async (tx) => {
    if (input.packageId) {
      const before = await tx.ptPackage.findFirst({ where: { id: input.packageId, deletedAt: null }, select: { id: true } });
      if (!before) throw new NotFoundError("Package not found.");
      // Already-sold packages keep their own copy (name, sessions, price), so editing is safe.
      await tx.ptPackage.update({ where: { id: before.id }, data, select: { id: true } });
      await recordAudit(tx, ctx, { action: "pt_package.update", entityType: "PtPackage", entityId: before.id, changes: data }, meta);
      return { id: before.id };
    }
    const row = await tx.ptPackage.create({ data: { gymId: ctx.gym.id, ...data }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "pt_package.create", entityType: "PtPackage", entityId: row.id, changes: data }, meta);
    return { id: row.id };
  });
}

/** Take a package off the catalog for good. Packages already sold are unaffected. */
export async function archivePackage(ctx: TenantContext, packageId: string, meta: RequestMeta) {
  assertCan(ctx, "pt.manage");
  assertWritable(ctx);
  return inTenant(ctx, async (tx) => {
    const p = await tx.ptPackage.findFirst({ where: { id: packageId, deletedAt: null }, select: { id: true } });
    if (!p) throw new NotFoundError("Package not found.");
    await tx.ptPackage.update({ where: { id: p.id }, data: { deletedAt: new Date(), isActive: false }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "pt_package.archive", entityType: "PtPackage", entityId: p.id }, meta);
    return { archived: true as const };
  });
}

/** Owner setting: do PT sessions need a package credit? */
export async function getCreditsRequired(ctx: TenantContext) {
  return inTenant(ctx, async (tx) => (await tx.gym.findUniqueOrThrow({ where: { id: ctx.gym.id }, select: { ptCreditsRequired: true } })).ptCreditsRequired);
}

export async function setCreditsRequired(ctx: TenantContext, required: boolean, meta: RequestMeta) {
  assertCan(ctx, "settings.manage");
  assertWritable(ctx);
  return inTenant(ctx, async (tx) => {
    await tx.gym.update({ where: { id: ctx.gym.id }, data: { ptCreditsRequired: required }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "settings.pt_credits", entityType: "Gym", entityId: ctx.gym.id, changes: { ptCreditsRequired: required } }, meta);
    return { required };
  });
}

// ─────────────────────────────── Selling ───────────────────────────────

export async function sellPackage(ctx: TenantContext, input: SellPtPackageInput, meta: RequestMeta) {
  assertCan(ctx, "payments.record");
  assertWritable(ctx);
  if (!ctx.staffId) throw new ValidationError("Only staff can sell packages.");
  const staffId = ctx.staffId;
  const today = todayFor(ctx);
  if (input.startsOn < addDays(today, -7) || input.startsOn > addDays(today, 90)) {
    throw new ValidationError("Choose a start date between a week ago and 90 days from now.", { startsOn: ["Start date out of range"] });
  }

  return inTenant(ctx, async (tx) => {
    const member = await tx.member.findFirst({ where: { id: input.memberId, ...visibilityWhere(ctx) }, select: { id: true, firstName: true, lastName: true } });
    if (!member) throw new NotFoundError("Member not found.");
    const pkg = await tx.ptPackage.findFirst({ where: { id: input.packageId, deletedAt: null } });
    if (!pkg || !pkg.isActive) throw new ValidationError("Choose a package that is on sale.", { packageId: ["Choose a package that is on sale."] });
    if (input.trainerId) {
      const trainer = await tx.staffMember.findFirst({ where: { id: input.trainerId, status: "ACTIVE", role: "TRAINER" }, select: { id: true } });
      if (!trainer) throw new ValidationError("Choose an active trainer, or any trainer.", { trainerId: ["Choose an active trainer."] });
    }

    const totals = invoiceTotals(pkg.priceMinor, ctx.gym.taxRateBps);
    const dueDate = addDays(today, PAYMENT_TERMS_DAYS);
    const expiresOn = addDays(input.startsOn, pkg.validityDays - 1);
    const invoiceNumber = await nextInvoiceNumber(tx, ctx);
    const invoice = await tx.invoice.create({
      data: {
        gymId: ctx.gym.id,
        number: invoiceNumber,
        description: `PT package: ${pkg.name} (${pkg.sessionCount} session${pkg.sessionCount === 1 ? "" : "s"})`,
        memberId: member.id,
        currency: ctx.gym.currency,
        ...totals,
        issuedAt: new Date(),
        dueDate: fromDateString(dueDate),
      },
      select: { id: true },
    });
    const purchaseId = createId();
    await tx.ptPackagePurchase.create({
      data: {
        id: purchaseId,
        gymId: ctx.gym.id,
        memberId: member.id,
        packageId: pkg.id,
        trainerId: input.trainerId,
        name: pkg.name,
        sessionsTotal: pkg.sessionCount,
        priceMinor: pkg.priceMinor,
        startsOn: fromDateString(input.startsOn),
        expiresOn: fromDateString(expiresOn),
        invoiceId: invoice.id,
        soldById: staffId,
      },
      select: { id: true },
    });
    const paidMinor = await payAtSale(tx, ctx, staffId, { id: invoice.id, memberId: member.id, totalMinor: totals.totalMinor, dueDate }, input, meta);
    await recordAudit(tx, ctx, {
      action: "pt_package.sell",
      entityType: "PtPackagePurchase",
      entityId: purchaseId,
      changes: { package: pkg.name, sessions: pkg.sessionCount, memberId: member.id, trainerId: input.trainerId, startsOn: input.startsOn, expiresOn, invoiceNumber, totalMinor: totals.totalMinor, paidMinor },
    }, meta);
    return { purchaseId, invoiceId: invoice.id, invoiceNumber, totalMinor: totals.totalMinor, paidMinor, startsOn: input.startsOn, expiresOn };
  });
}

/**
 * The purchase an invoice paid for is cancelled with it (invoice voided, or refunded with
 * "cancel what it paid for"). Sessions still to come lose their credit but stay booked, so
 * nobody's appointment silently disappears; staff see them as not covered.
 */
export async function cancelPurchaseOfInvoice(tx: Tx, ctx: TenantContext, invoiceId: string, reason: string, meta: RequestMeta) {
  const p = await tx.ptPackagePurchase.findFirst({ where: { invoiceId, cancelledAt: null }, select: { id: true } });
  if (!p) return null;
  const uncovered = await tx.trainingSession.updateMany({ where: { purchaseId: p.id, status: "SCHEDULED", startsAt: { gt: new Date() } }, data: { purchaseId: null } });
  await tx.ptPackagePurchase.update({ where: { id: p.id }, data: { cancelledAt: new Date(), cancelReason: reason.slice(0, 300) }, select: { id: true } });
  await recordAudit(tx, ctx, { action: "pt_package.cancel", entityType: "PtPackagePurchase", entityId: p.id, changes: { invoiceId, reason, sessionsUncovered: uncovered.count } }, meta);
  return { purchaseId: p.id, sessionsUncovered: uncovered.count };
}

// ─────────────────────────────── Balances ───────────────────────────────

/** A member's packages with what's left, newest first. Callers check who may see them. */
export async function packagesOf(tx: Tx, memberId: string, today: string) {
  const rows = await tx.ptPackagePurchase.findMany({
    where: { memberId },
    orderBy: [{ expiresOn: "desc" }, { createdAt: "desc" }],
    take: 30,
    select: {
      id: true,
      name: true,
      sessionsTotal: true,
      startsOn: true,
      expiresOn: true,
      cancelledAt: true,
      cancelReason: true,
      trainerId: true,
      trainer: { select: { user: { select: { name: true } } } },
      invoice: { select: { id: true, number: true, status: true, totalMinor: true, amountPaidMinor: true } },
    },
  });
  const used = await creditsUsed(tx, rows.map((r) => r.id));
  return rows.map((r) => {
    const startsOn = toDateString(r.startsOn);
    const expiresOn = toDateString(r.expiresOn);
    const u = used.get(r.id) ?? 0;
    const { state, remaining } = packageState({ sessionsTotal: r.sessionsTotal, startsOn, expiresOn, cancelledAt: r.cancelledAt }, u, today);
    return {
      id: r.id,
      name: r.name,
      sessionsTotal: r.sessionsTotal,
      used: u,
      remaining,
      state,
      startsOn,
      expiresOn,
      cancelReason: r.cancelReason,
      trainer: r.trainerId ? { id: r.trainerId, name: r.trainer!.user.name } : null,
      invoice: r.invoice,
    };
  });
}

/** For pages: a member's packages (staff who coach, sell or manage PT). */
export async function memberPackages(ctx: TenantContext, memberId: string) {
  canSeeCatalog(ctx);
  return inTenant(ctx, async (tx) => {
    const member = await tx.member.findFirst({ where: { id: memberId, ...visibilityWhere(ctx) }, select: { id: true } });
    if (!member) throw new NotFoundError("Member not found.");
    return packagesOf(tx, memberId, todayFor(ctx));
  });
}
