import "server-only";
import { formatInvoiceNumber } from "@/domain/billing";
import { addDays, dayBounds, fromDateString, isDateString, toDateString } from "@/domain/dates";
import { formatMemberNumber } from "@/domain/member-search";
import type { MemberInput } from "@/lib/validation/members";
import type { SellMembershipInput } from "@/lib/validation/payments";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, assertWritable, hasPermission, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { recordPayment } from "./billing/payments";
import { listInvoices } from "./billing/queries";
import { sellMembership } from "./billing/sell";
import { checkInMember, listCheckInLocations, lookupForCheckIn, todaysCheckIns } from "./checkin";
import { canMarkAttendance } from "@/domain/classes";
import { getSession, ownSessionsOnly } from "./classes/sessions";
import { getDashboard } from "./dashboard";
import { listMembershipPlans } from "./membership-plans";
import { createMember } from "./members/commands";
import { listMembers } from "./members/list";
import { getMemberProfile } from "./members/profile";
import { todayFor } from "./members/shared";

/**
 * The staff side of the mobile app: thin adapters over the same services the web portal uses
 * (permissions, plan limits, encryption, audit all happen there). Writes also check that the gym
 * isn't read-only, as the web's action wrapper does.
 */

const iso = (d: Date) => d.toISOString();

// ─────────────────────────────── Check-in ───────────────────────────────

export async function checkInSetup(ctx: TenantContext) {
  const locations = await listCheckInLocations(ctx);
  const today = await todaysCheckIns(ctx);
  return { locations, today: { allowed: today.allowed, denied: today.denied } };
}

export async function checkInLookup(ctx: TenantContext, query: string) {
  const r = await lookupForCheckIn(ctx, query);
  return {
    method: r.method,
    candidates: r.candidates.map((c) => ({ id: c.id, name: c.name, memberNumber: c.memberNumber, decision: { result: c.decision.result, message: c.decision.message }, overdueInvoices: c.overdueInvoices })),
  };
}

export async function checkIn(ctx: TenantContext, input: { memberId: string; locationId: string; method: "NAME_SEARCH" | "MEMBER_ID" | "QR" }, meta: RequestMeta) {
  assertWritable(ctx);
  const r = await checkInMember(ctx, input, meta);
  return { memberId: input.memberId, name: r.name, result: r.result, message: r.message, duplicate: r.duplicate, overdueInvoices: r.overdueInvoices, checkedInAt: iso(r.checkedInAt) };
}

// ─────────────────────────────── Dashboard & alerts ───────────────────────────────

async function sessionsBetween(ctx: TenantContext, from: Date, to: Date) {
  return inTenant(ctx, async (tx) => {
    const rows = await tx.classSession.findMany({
      where: { startsAt: { gte: from, lt: to }, ...(ownSessionsOnly(ctx) ? { trainerId: ctx.staffId ?? "__none__" } : {}) },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
        capacity: true,
        classType: { select: { name: true, color: true } },
        room: { select: { name: true, location: { select: { name: true } } } },
        trainer: { select: { user: { select: { name: true } } } },
        bookings: { where: { status: { in: ["BOOKED", "ATTENDED", "NO_SHOW", "WAITLISTED"] } }, select: { status: true } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      startsAt: iso(s.startsAt),
      endsAt: iso(s.endsAt),
      status: s.status,
      className: s.classType.name,
      classColor: s.classType.color,
      trainer: s.trainer.user.name,
      room: s.room?.name ?? "Online",
      location: s.room?.location.name ?? "Online",
      capacity: s.capacity,
      booked: s.bookings.filter((b) => b.status !== "WAITLISTED").length,
      waitlisted: s.bookings.filter((b) => b.status === "WAITLISTED").length,
    }));
  });
}

async function overdueSummary(ctx: TenantContext) {
  if (!hasPermission(ctx, "payments.view")) return null;
  const today = todayFor(ctx);
  return inTenant(ctx, async (tx) => {
    const agg = await tx.invoice.aggregate({
      where: { status: "OPEN", deletedAt: null, dueDate: { lt: fromDateString(today) } },
      _count: { _all: true },
      _sum: { totalMinor: true, amountPaidMinor: true },
    });
    return { count: agg._count._all, totalMinor: (agg._sum.totalMinor ?? 0) - (agg._sum.amountPaidMinor ?? 0) };
  });
}

export async function staffDashboard(ctx: TenantContext) {
  const d = await getDashboard(ctx);
  const day = dayBounds(d.today, ctx.gym.timezone);
  const classes = await sessionsBetween(ctx, day.start, day.end);
  return {
    today: d.today,
    checkInsToday: d.checkInsToday,
    activeMembers: d.activeMembers,
    newThisMonth: d.newThisMonth,
    currency: ctx.gym.currency,
    revenue: d.revenue ? { todayMinor: d.revenue.today, monthMinor: d.revenue.month } : null,
    expiring: d.expiring.map((e) => ({ memberId: e.memberId, name: e.name, plan: e.plan, endDate: e.endDate })),
    overdue: await overdueSummary(ctx),
    todaysClasses: classes.map((c) => ({ id: c.id, startsAt: c.startsAt, className: c.className, classColor: c.classColor, trainer: c.trainer, room: c.room, capacity: c.capacity, booked: c.booked, waitlisted: c.waitlisted, status: c.status })),
  };
}

export async function staffAlerts(ctx: TenantContext) {
  assertCan(ctx, "dashboard.view");
  const d = await getDashboard(ctx);
  let overdue: { invoiceId: string; number: string; memberId: string; memberName: string; dueDate: string; outstandingMinor: number }[] | null = null;
  if (hasPermission(ctx, "payments.view")) {
    const r = await listInvoices(ctx, { status: "overdue", page: 1 });
    overdue = r.rows.map((i) => ({
      invoiceId: i.id,
      number: formatInvoiceNumber(i.number),
      memberId: i.member.id,
      memberName: `${i.member.firstName} ${i.member.lastName}`,
      dueDate: typeof i.dueDate === "string" ? i.dueDate : toDateString(i.dueDate),
      outstandingMinor: i.totalMinor - i.amountPaidMinor,
    }));
  }
  const now = new Date();
  const week = await sessionsBetween(ctx, now, new Date(now.getTime() + 7 * 86_400_000));
  return {
    currency: ctx.gym.currency,
    expiring: d.expiring.map((e) => ({ memberId: e.memberId, name: e.name, plan: e.plan, endDate: e.endDate })),
    overdue,
    fullClasses: week
      .filter((c) => c.status === "SCHEDULED" && c.booked >= c.capacity)
      .map((c) => ({ sessionId: c.id, className: c.className, startsAt: c.startsAt, capacity: c.capacity, waitlisted: c.waitlisted })),
  };
}

// ─────────────────────────────── Members ───────────────────────────────

export async function staffMembers(ctx: TenantContext, query: { q?: string; status?: "active" | "frozen" | "expired" | "none"; cursor?: string }) {
  const page = query.cursor ? Number(query.cursor) : 1;
  const r = await listMembers(ctx, { q: query.q || undefined, status: query.status, page });
  return {
    total: r.total,
    nextCursor: r.page < r.pageCount ? String(r.page + 1) : null,
    items: r.rows.map((m) => ({
      id: m.id,
      memberNumber: formatMemberNumber(m.memberNumber),
      name: m.name,
      phone: m.phone,
      status: m.status,
      planName: m.planName,
      endDate: m.endDate,
      lastVisit: m.lastVisit ? iso(m.lastVisit) : null,
    })),
  };
}

export async function staffMemberProfile(ctx: TenantContext, memberId: string) {
  const p = await getMemberProfile(ctx, memberId);
  const account = await inTenant(ctx, (tx) => tx.memberAccount.findUnique({ where: { memberId }, select: { status: true } }));
  const writable = ctx.access.writable && !ctx.supportSessionId;
  const today = todayFor(ctx);
  return {
    member: {
      id: p.member.id,
      memberNumber: formatMemberNumber(p.member.memberNumber),
      name: `${p.member.firstName} ${p.member.lastName}`,
      email: p.member.email,
      phone: p.member.phone,
      address: p.member.address,
      emergencyContact: p.member.emergencyContact?.name ? { name: p.member.emergencyContact.name, phone: p.member.emergencyContact.phone ?? null, relation: p.member.emergencyContact.relation ?? null } : null,
      joinedAt: iso(p.member.joinedAt),
    },
    status: p.status,
    memberships: p.memberships.map((m) => ({ id: m.id, planName: m.planName, state: m.state, startDate: m.startDate, endDate: m.endDate, classCreditsRemaining: m.classCreditsRemaining })),
    visits: p.visits,
    recentCheckIns: p.checkIns.slice(0, 10).map((c) => ({ id: c.id, checkedInAt: iso(c.checkedInAt), allowed: c.result === "ALLOWED", location: c.location.name })),
    payments: p.permissions.canSeePayments
      ? p.payments.slice(0, 20).map((x) => ({ id: x.id, receivedAt: iso(x.receivedAt), amountMinor: x.amountMinor, refundedMinor: x.refundedMinor, method: x.method, invoiceNumber: x.invoice ? formatInvoiceNumber(x.invoice.number) : null }))
      : null,
    openInvoices: p.permissions.canSeePayments
      ? p.openInvoices.map((i) => {
          const dueDate = toDateString(i.dueDate);
          return { id: i.id, number: formatInvoiceNumber(i.number), description: null, dueDate, totalMinor: i.totalMinor, amountPaidMinor: i.amountPaidMinor, overdue: dueDate < today && i.amountPaidMinor < i.totalMinor };
        })
      : null,
    appAccount: account ? { status: account.status } : null,
    currency: ctx.gym.currency,
    can: {
      recordPayment: writable && hasPermission(ctx, "payments.record"),
      sellMembership: writable && hasPermission(ctx, "payments.record"),
      inviteToApp: writable && hasPermission(ctx, "members.editContact") && !!ctx.plan?.features.memberApp && account?.status !== "ACTIVE",
    },
  };
}

export async function staffCreateMember(ctx: TenantContext, input: MemberInput, meta: RequestMeta) {
  assertWritable(ctx);
  const r = await createMember(ctx, input, meta);
  return { memberId: r.id, memberNumber: formatMemberNumber(r.memberNumber) };
}

// ─────────────────────────────── Payments ───────────────────────────────

export async function staffPlans(ctx: TenantContext) {
  const plans = await listMembershipPlans(ctx);
  return {
    currency: ctx.gym.currency,
    taxRateBps: ctx.gym.taxRateBps,
    plans: plans
      .filter((p) => p.isActive)
      .map((p) => ({ id: p.id, name: p.name, type: p.type, priceMinor: p.priceMinor, durationDays: p.durationDays, classCredits: p.classCredits })),
  };
}

export async function staffSell(ctx: TenantContext, input: SellMembershipInput, meta: RequestMeta) {
  assertWritable(ctx);
  const r = await sellMembership(ctx, input, meta);
  return { membershipId: r.membershipId, invoiceId: r.invoiceId, invoiceNumber: formatInvoiceNumber(r.invoiceNumber), totalMinor: r.totalMinor, paidMinor: r.paidMinor, startDate: r.startDate, endDate: r.endDate };
}

export async function staffRecordPayment(ctx: TenantContext, input: { invoiceId: string; amount: number; method: "CASH" | "CARD" | "TRANSFER"; reference: string | null }, meta: RequestMeta) {
  assertWritable(ctx);
  const r = await recordPayment(ctx, input, meta);
  return { paymentId: r.paymentId, invoiceStatus: r.status, amountPaidMinor: r.amountPaidMinor };
}

// ─────────────────────────────── Classes ───────────────────────────────

export async function staffClasses(ctx: TenantContext, query: { from?: string; to?: string }) {
  assertCan(ctx, "classes.view");
  const today = todayFor(ctx);
  const from = query.from && isDateString(query.from) ? query.from : today;
  let to = query.to && isDateString(query.to) ? query.to : addDays(today, 6);
  if (to < from) throw new ValidationError("Choose a valid date range.");
  if (to > addDays(from, 31)) to = addDays(from, 31);
  const tz = ctx.gym.timezone;
  return { from, to, classes: await sessionsBetween(ctx, dayBounds(from, tz).start, dayBounds(to, tz).end) };
}

export async function staffClass(ctx: TenantContext, sessionId: string) {
  const s = await getSession(ctx, sessionId);
  if (!s) throw new NotFoundError("Class not found.");
  const live = s.bookings.filter((b) => b.status !== "CANCELLED");
  return {
    id: s.id,
    startsAt: iso(s.startsAt),
    endsAt: iso(s.endsAt),
    status: s.status,
    className: s.classType.name,
    classColor: s.classType.color,
    trainer: s.trainer.user.name,
    room: s.room?.name ?? "Online",
    location: s.room?.location.name ?? "Online",
    capacity: s.capacity,
    booked: live.filter((b) => b.status !== "WAITLISTED").length,
    waitlisted: live.filter((b) => b.status === "WAITLISTED").length,
    canMarkAttendance:
      s.status !== "CANCELLED" &&
      (ctx.permissions.has("classes.manage") || (ctx.permissions.has("classes.manageOwn") && s.trainerId === ctx.staffId)) &&
      canMarkAttendance(s),
    bookings: s.bookings.map((b) => ({
      bookingId: b.id,
      memberId: b.member.id,
      name: `${b.member.firstName} ${b.member.lastName}`,
      memberNumber: formatMemberNumber(b.member.memberNumber),
      status: b.status,
      waitlistPosition: b.waitlistPosition,
    })),
  };
}

