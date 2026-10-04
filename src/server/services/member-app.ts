import "server-only";
import { formatInvoiceNumber, isOverdue } from "@/domain/billing";
import { addDays, dayBounds, isDateString, localDate, toDateString, type DateString } from "@/domain/dates";
import { formatMemberNumber } from "@/domain/member-search";
import { currentMembership, daysRemaining, membershipStateOn, type MembershipRecord } from "@/domain/membership";
import { NotFoundError, ValidationError } from "@/server/errors";
import { MEMBER_QR_REFRESH_SECONDS, mintMemberQr } from "@/server/mobile/qr";
import { inMember, type MemberContext } from "@/server/tenant/member";

/**
 * Everything a member sees about themselves in the member app. Every query runs as the member
 * (member-scoped RLS): the database itself only returns their own rows and the gym's catalog.
 */

const today = (ctx: MemberContext): DateString => localDate(new Date(), ctx.gym.timezone);

// ─────────────────────────────── Memberships ───────────────────────────────

type MembershipRow = {
  id: string;
  status: MembershipRecord["status"];
  startDate: Date;
  endDate: Date;
  cancelledAt: Date | null;
  classCreditsRemaining: number | null;
  plan: { name: string; type: "MONTHLY" | "QUARTERLY" | "YEARLY" | "CLASS_PACK" };
  freezes: { startDate: Date; endDate: Date }[];
};

function asRecord(m: MembershipRow): MembershipRecord {
  return {
    id: m.id,
    status: m.status,
    startDate: toDateString(m.startDate),
    endDate: toDateString(m.endDate),
    cancelledAt: m.cancelledAt,
    freezes: m.freezes.map((f) => ({ startDate: toDateString(f.startDate), endDate: toDateString(f.endDate) })),
  };
}

function view(m: MembershipRow, day: DateString) {
  const r = asRecord(m);
  const freeze = r.freezes.find((f) => f.startDate <= day && f.endDate >= day) ?? r.freezes.find((f) => f.startDate > day) ?? null;
  return {
    id: m.id,
    planName: m.plan.name,
    planType: m.plan.type,
    state: membershipStateOn(r, day),
    startDate: r.startDate,
    endDate: r.endDate,
    daysRemaining: Math.max(0, daysRemaining(r, day)),
    classCreditsRemaining: m.classCreditsRemaining,
    frozen: freeze ? { from: freeze.startDate, to: freeze.endDate } : null,
    cancelledAt: m.cancelledAt?.toISOString() ?? null,
  };
}

async function loadMemberships(ctx: MemberContext) {
  return inMember(ctx, async (tx) => ({
    member: await tx.member.findUniqueOrThrow({ where: { id: ctx.memberId }, select: { firstName: true, lastName: true, memberNumber: true } }),
    memberships: (await tx.membership.findMany({
      where: { memberId: ctx.memberId },
      orderBy: { startDate: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        cancelledAt: true,
        classCreditsRemaining: true,
        plan: { select: { name: true, type: true } },
        freezes: { select: { startDate: true, endDate: true }, orderBy: { startDate: "asc" } },
      },
    })) as MembershipRow[],
  }));
}

const summary = (m: { firstName: string; lastName: string; memberNumber: number }) => ({ name: `${m.firstName} ${m.lastName}`, memberNumber: formatMemberNumber(m.memberNumber) });

export async function memberCard(ctx: MemberContext) {
  const day = today(ctx);
  const { member, memberships } = await loadMemberships(ctx);
  const current = currentMembership(memberships.map((m) => ({ ...asRecord(m), row: m })), day);
  const qr = mintMemberQr(ctx.gym.id, ctx.memberId);
  return {
    member: summary(member),
    membership: current ? view(current.row, day) : null,
    qr: { token: qr.token, expiresAt: qr.expiresAt.toISOString(), refreshInSeconds: MEMBER_QR_REFRESH_SECONDS },
  };
}

export async function memberMembership(ctx: MemberContext) {
  const day = today(ctx);
  const { member, memberships } = await loadMemberships(ctx);
  const views = memberships.map((m) => view(m, day));
  const current = currentMembership(memberships.map((m) => ({ ...asRecord(m), row: m })), day);
  const currentView = current ? view(current.row, day) : null;
  const upcoming = views.filter((v) => v.state === "upcoming").sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = views.filter((v) => v.id !== currentView?.id && v.state !== "upcoming");
  let renewal: { daysLeft: number; message: string } | null = null;
  if (currentView && upcoming.length === 0 && currentView.state !== "cancelled" && currentView.daysRemaining <= 14) {
    const d = currentView.daysRemaining;
    renewal = { daysLeft: d, message: d === 0 ? "Your membership ends today. Renew at the front desk to keep training." : `Your membership ends in ${d} day${d === 1 ? "" : "s"}. Renew at the front desk to keep training.` };
  }
  return {
    member: summary(member),
    current: currentView,
    upcoming,
    past: past.slice(0, 10),
    renewal,
    rules: { bookingDaysAhead: ctx.gym.memberBookingDaysAhead, cancelHoursBefore: ctx.gym.memberCancelHours },
  };
}

// ─────────────────────────────── Classes ───────────────────────────────

type ScheduleRow = {
  id: string;
  starts_at: Date;
  ends_at: Date;
  status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  capacity: number;
  class_name: string;
  class_color: string;
  class_description: string | null;
  room_name: string;
  location_name: string;
  trainer_name: string;
  booked: number;
  waitlisted: number;
};

/** The timetable from today to the end of the booking window (or a range within it). */
export async function memberClasses(ctx: MemberContext, query: { from?: string; to?: string }) {
  const day = today(ctx);
  const lastDay = addDays(day, ctx.gym.memberBookingDaysAhead);
  const from = query.from && isDateString(query.from) && query.from >= addDays(day, -30) ? query.from : day;
  let to = query.to && isDateString(query.to) ? query.to : lastDay;
  if (to > lastDay) to = lastDay;
  if (from > to) throw new ValidationError("Choose a valid date range.");
  const tz = ctx.gym.timezone;
  const start = dayBounds(from, tz).start;
  const end = dayBounds(to, tz).end;

  const { rows, mine } = await inMember(ctx, async (tx) => {
    const rows = await tx.$queryRaw<ScheduleRow[]>`SELECT * FROM member_class_schedule(${start}, ${end})`;
    const mine = await tx.booking.findMany({
      where: { memberId: ctx.memberId, sessionId: { in: rows.map((r) => r.id) }, status: { not: "CANCELLED" } },
      select: { id: true, sessionId: true, status: true, waitlistPosition: true },
    });
    return { rows, mine };
  });
  const byId = new Map(mine.map((b) => [b.sessionId, b]));
  const now = Date.now();
  const horizon = now + ctx.gym.memberBookingDaysAhead * 86_400_000;
  const bookingOpen = !!ctx.plan?.features.classBookings && ctx.access.writable;

  return {
    from,
    to,
    rules: { bookingDaysAhead: ctx.gym.memberBookingDaysAhead, cancelHoursBefore: ctx.gym.memberCancelHours },
    classes: rows.map((r) => {
      const my = byId.get(r.id);
      const deadline = r.starts_at.getTime() - ctx.gym.memberCancelHours * 3_600_000;
      const upcoming = r.status === "SCHEDULED" && r.starts_at.getTime() > now;
      const active = my && (my.status === "BOOKED" || my.status === "WAITLISTED");
      return {
        id: r.id,
        startsAt: r.starts_at.toISOString(),
        endsAt: r.ends_at.toISOString(),
        status: r.status,
        className: r.class_name,
        classColor: r.class_color,
        description: r.class_description,
        room: r.room_name,
        location: r.location_name,
        trainer: r.trainer_name,
        capacity: r.capacity,
        booked: r.booked,
        waitlisted: r.waitlisted,
        spotsLeft: Math.max(0, r.capacity - r.booked),
        my: my ? { bookingId: my.id, status: my.status as "BOOKED" | "WAITLISTED" | "ATTENDED" | "NO_SHOW", waitlistPosition: my.waitlistPosition } : null,
        canBook: bookingOpen && upcoming && !my && r.starts_at.getTime() <= horizon,
        canCancel: !!active && r.ends_at.getTime() > now && (my!.status === "WAITLISTED" || now < deadline),
        cancelDeadline: new Date(deadline).toISOString(),
      };
    }),
  };
}

// ─────────────────────────────── History (paginated) ───────────────────────────────

/** Cursor = "<ISO time>|<id>" (base64url), for stable newest-first paging. */
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !/^[\w-]{1,64}$/.test(id ?? "")) throw new Error();
    return { at, id };
  } catch {
    throw new ValidationError("Invalid cursor.");
  }
}
const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");

function page<T>(rows: T[], limit: number, key: (row: T) => { at: Date; id: string }) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(key(last).at, key(last).id) : null };
}

const before = (field: string, c: { at: Date; id: string } | null) =>
  c ? { OR: [{ [field]: { lt: c.at } }, { [field]: c.at, id: { lt: c.id } }] } : {};

const REASONS: Record<string, string> = { DENIED_EXPIRED: "Membership expired", DENIED_FROZEN: "Membership frozen", DENIED_NO_MEMBERSHIP: "No active membership" };

export async function memberAttendance(ctx: MemberContext, q: { cursor?: string; limit: number }) {
  const c = decodeCursor(q.cursor);
  const rows = await inMember(ctx, (tx) =>
    tx.checkIn.findMany({
      where: { memberId: ctx.memberId, ...before("checkedInAt", c) },
      orderBy: [{ checkedInAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      select: { id: true, checkedInAt: true, result: true, location: { select: { name: true } } },
    })
  );
  const p = page(rows, q.limit, (r) => ({ at: r.checkedInAt, id: r.id }));
  return {
    nextCursor: p.nextCursor,
    items: p.items.map((r) => ({ id: r.id, checkedInAt: r.checkedInAt.toISOString(), location: r.location.name, allowed: r.result === "ALLOWED", reason: REASONS[r.result] ?? null })),
  };
}

const paymentSelect = {
  id: true,
  receivedAt: true,
  amountMinor: true,
  currency: true,
  method: true,
  status: true,
  refunds: { select: { amountMinor: true } },
  invoice: { select: { id: true, number: true } },
} as const;

type PaymentRow = {
  id: string;
  receivedAt: Date;
  amountMinor: number;
  currency: string;
  method: "CASH" | "CARD" | "TRANSFER";
  status: "COMPLETED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "VOID";
  refunds: { amountMinor: number }[];
  invoice: { id: string; number: number } | null;
};

function paymentView(p: PaymentRow) {
  return {
    id: p.id,
    receivedAt: p.receivedAt.toISOString(),
    amountMinor: p.amountMinor,
    refundedMinor: p.refunds.reduce((s, r) => s + r.amountMinor, 0),
    currency: p.currency,
    method: p.method,
    status: p.status,
    invoice: p.invoice ? { id: p.invoice.id, number: formatInvoiceNumber(p.invoice.number) } : null,
  };
}

export async function memberPayments(ctx: MemberContext, q: { cursor?: string; limit: number }) {
  const c = decodeCursor(q.cursor);
  const rows = (await inMember(ctx, (tx) =>
    tx.payment.findMany({ where: { memberId: ctx.memberId, deletedAt: null, ...before("receivedAt", c) }, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: q.limit + 1, select: paymentSelect })
  )) as PaymentRow[];
  const p = page(rows, q.limit, (r) => ({ at: r.receivedAt, id: r.id }));
  return { nextCursor: p.nextCursor, items: p.items.map(paymentView) };
}

type InvoiceRow = {
  id: string;
  number: number;
  description: string | null;
  issuedAt: Date;
  dueDate: Date;
  currency: string;
  totalMinor: number;
  amountPaidMinor: number;
  status: "OPEN" | "PAID" | "VOID";
};

function invoiceView(i: InvoiceRow, day: DateString) {
  const dueDate = toDateString(i.dueDate);
  return {
    id: i.id,
    number: formatInvoiceNumber(i.number),
    description: i.description,
    issuedAt: i.issuedAt.toISOString(),
    dueDate,
    currency: i.currency,
    totalMinor: i.totalMinor,
    amountPaidMinor: i.amountPaidMinor,
    status: isOverdue({ status: i.status, totalMinor: i.totalMinor, amountPaidMinor: i.amountPaidMinor, dueDate }, day) ? ("OVERDUE" as const) : i.status,
  };
}

const invoiceSelect = { id: true, number: true, description: true, issuedAt: true, dueDate: true, currency: true, totalMinor: true, amountPaidMinor: true, status: true } as const;

export async function memberInvoices(ctx: MemberContext, q: { cursor?: string; limit: number }) {
  const c = decodeCursor(q.cursor);
  const rows = (await inMember(ctx, (tx) =>
    tx.invoice.findMany({ where: { memberId: ctx.memberId, deletedAt: null, ...before("issuedAt", c) }, orderBy: [{ issuedAt: "desc" }, { id: "desc" }], take: q.limit + 1, select: invoiceSelect })
  )) as InvoiceRow[];
  const p = page(rows, q.limit, (r) => ({ at: r.issuedAt, id: r.id }));
  const day = today(ctx);
  return { nextCursor: p.nextCursor, items: p.items.map((i) => invoiceView(i, day)) };
}

export async function memberInvoice(ctx: MemberContext, invoiceId: string) {
  const found = await inMember(ctx, async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, memberId: ctx.memberId, deletedAt: null },
      select: { ...invoiceSelect, subtotalMinor: true, taxMinor: true, payments: { where: { deletedAt: null }, orderBy: { receivedAt: "asc" }, select: paymentSelect } },
    });
    const gym = await tx.gym.findUniqueOrThrow({ where: { id: ctx.gym.id }, select: { name: true, address: true, email: true, phone: true } });
    return invoice ? { invoice, gym } : null;
  });
  if (!found) throw new NotFoundError("Invoice not found.");
  const { invoice, gym } = found;
  return {
    ...invoiceView(invoice as InvoiceRow, today(ctx)),
    subtotalMinor: invoice.subtotalMinor,
    taxMinor: invoice.taxMinor,
    gym,
    payments: (invoice.payments as PaymentRow[]).map((p) => {
      const { invoice: _invoice, ...rest } = paymentView(p);
      return rest;
    }),
  };
}
