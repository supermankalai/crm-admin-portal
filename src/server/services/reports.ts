import "server-only";
import { formatInvoiceNumber } from "@/domain/billing";
import { dayBounds, diffDays, formatDate, localDate, monthBounds, type DateString } from "@/domain/dates";
import { formatMemberNumber } from "@/domain/member-search";
import {
  bucketLabel,
  csvMoney,
  heatmapGrid,
  hourLabel,
  monthLastDay,
  rangeBuckets,
  retentionRates,
  revenueGrain,
  toCsv,
  WEEKDAYS,
  type DateRange,
  type ReportKind,
  type RetentionMonth,
} from "@/domain/reports";
import { recordAudit } from "@/server/audit/tenant-audit";
import { assertFeature } from "@/server/plan/limits";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { todayFor } from "./members/shared";

/**
 * Gym reports. Every figure is computed by PostgreSQL in the gym's RLS context and the gym's
 * time zone; ranges are inclusive local dates, converted to instants with dayBounds().
 * Revenue is money received minus refunds given in the period (cash basis).
 */

export function assertReports(ctx: TenantContext) {
  assertCan(ctx, "reports.view");
  assertFeature(ctx, "reports");
}

function instants(ctx: TenantContext, range: DateRange) {
  const tz = ctx.gym.timezone;
  return { start: dayBounds(range.from, tz).start, end: dayBounds(range.to, tz).end, tz };
}

const PAID = `"deletedAt" IS NULL AND status <> 'VOID'`;

// ─────────────────────────────── Revenue ───────────────────────────────

export async function revenueReport(ctx: TenantContext, range: DateRange) {
  assertReports(ctx);
  const { start, end, tz } = instants(ctx, range);
  const grain = revenueGrain(range);
  const fmt = grain === "day" ? "YYYY-MM-DD" : "YYYY-MM-01";

  return inTenant(ctx, async (tx) => {
    const paid = await tx.$queryRawUnsafe<{ k: string; total: bigint; n: number }[]>(
      `SELECT to_char(date_trunc('${grain}', "receivedAt" AT TIME ZONE $1), '${fmt}') AS k, sum("amountMinor")::bigint AS total, count(*)::int AS n
         FROM "Payment" WHERE ${PAID} AND "receivedAt" >= $2 AND "receivedAt" < $3 GROUP BY 1`,
      tz,
      start,
      end
    );
    const refunded = await tx.$queryRawUnsafe<{ k: string; total: bigint }[]>(
      `SELECT to_char(date_trunc('${grain}', "refundedAt" AT TIME ZONE $1), '${fmt}') AS k, sum("amountMinor")::bigint AS total
         FROM "Refund" WHERE "refundedAt" >= $2 AND "refundedAt" < $3 GROUP BY 1`,
      tz,
      start,
      end
    );
    const byMethodRows = await tx.$queryRawUnsafe<{ method: "CASH" | "CARD" | "TRANSFER"; received: bigint; n: number }[]>(
      `SELECT method, sum("amountMinor")::bigint AS received, count(*)::int AS n
         FROM "Payment" WHERE ${PAID} AND "receivedAt" >= $1 AND "receivedAt" < $2 GROUP BY 1`,
      start,
      end
    );
    const refundsByMethod = await tx.$queryRawUnsafe<{ method: string; total: bigint }[]>(
      `SELECT p.method, sum(r."amountMinor")::bigint AS total FROM "Refund" r JOIN "Payment" p ON p.id = r."paymentId"
        WHERE r."refundedAt" >= $1 AND r."refundedAt" < $2 GROUP BY 1`,
      start,
      end
    );
    const byPlanRows = await tx.$queryRawUnsafe<{ plan: string | null; received: bigint; n: number }[]>(
      `SELECT pl.name AS plan, sum(p."amountMinor")::bigint AS received, count(*)::int AS n
         FROM "Payment" p
         LEFT JOIN "Invoice" i ON i.id = p."invoiceId"
         LEFT JOIN "Membership" ms ON ms.id = i."membershipId"
         LEFT JOIN "MembershipPlan" pl ON pl.id = ms."planId"
        WHERE p."deletedAt" IS NULL AND p.status <> 'VOID' AND p."receivedAt" >= $1 AND p."receivedAt" < $2
        GROUP BY pl.name ORDER BY received DESC`,
      start,
      end
    );

    const paidBy = new Map(paid.map((r) => [r.k, Number(r.total)]));
    const refundedBy = new Map(refunded.map((r) => [r.k, Number(r.total)]));
    const series = rangeBuckets(range, grain).map((k) => {
      const received = paidBy.get(k) ?? 0;
      const refunds = refundedBy.get(k) ?? 0;
      return { key: k, label: bucketLabel(k, grain), receivedMinor: received, refundsMinor: refunds, netMinor: received - refunds };
    });
    const refundMethod = new Map(refundsByMethod.map((r) => [r.method, Number(r.total)]));
    const received = series.reduce((s, r) => s + r.receivedMinor, 0);
    const refunds = series.reduce((s, r) => s + r.refundsMinor, 0);
    const payments = paid.reduce((s, r) => s + r.n, 0);

    return {
      grain,
      series,
      totals: { receivedMinor: received, refundsMinor: refunds, netMinor: received - refunds, payments, averageMinor: payments ? Math.round(received / payments) : 0 },
      byMethod: byMethodRows
        .map((r) => ({ method: r.method, receivedMinor: Number(r.received), refundsMinor: refundMethod.get(r.method) ?? 0, payments: r.n }))
        .sort((a, b) => b.receivedMinor - a.receivedMinor),
      byPlan: byPlanRows.map((r) => ({ plan: r.plan ?? "Other charges", receivedMinor: Number(r.received), payments: r.n })),
    };
  });
}

// ────────────────────────────── Attendance ──────────────────────────────

export async function attendanceReport(ctx: TenantContext, range: DateRange) {
  assertReports(ctx);
  const { start, end, tz } = instants(ctx, range);
  return inTenant(ctx, async (tx) => {
    const cells = await tx.$queryRawUnsafe<{ isoDow: number; hour: number; n: number }[]>(
      `SELECT extract(isodow FROM "checkedInAt" AT TIME ZONE $1)::int AS "isoDow", extract(hour FROM "checkedInAt" AT TIME ZONE $1)::int AS hour, count(*)::int AS n
         FROM "CheckIn" WHERE result = 'ALLOWED' AND "checkedInAt" >= $2 AND "checkedInAt" < $3 GROUP BY 1, 2`,
      tz,
      start,
      end
    );
    const [totals] = await tx.$queryRawUnsafe<{ allowed: number; denied: number; members: number }[]>(
      `SELECT count(*) FILTER (WHERE result = 'ALLOWED')::int AS allowed, count(*) FILTER (WHERE result <> 'ALLOWED')::int AS denied,
              count(DISTINCT "memberId") FILTER (WHERE result = 'ALLOWED')::int AS members
         FROM "CheckIn" WHERE "checkedInAt" >= $1 AND "checkedInAt" < $2`,
      start,
      end
    );
    const byLocation = await tx.$queryRawUnsafe<{ name: string; n: number }[]>(
      `SELECT l.name, count(*)::int AS n FROM "CheckIn" c JOIN "Location" l ON l.id = c."locationId"
        WHERE c.result = 'ALLOWED' AND c."checkedInAt" >= $1 AND c."checkedInAt" < $2 GROUP BY l.name ORDER BY n DESC`,
      start,
      end
    );
    const days = diffDays(range.from, range.to) + 1;
    // How many of each weekday the range contains, for a fair per-weekday average.
    const weekdayCount = Array<number>(7).fill(0);
    for (let i = 0; i < days; i++) weekdayCount[(new Date(`${range.from}T00:00:00Z`).getUTCDay() + 6 + i) % 7] += 1;
    const grid = heatmapGrid(cells);
    return {
      grid,
      days,
      totals: { ...totals, perDay: Math.round((totals.allowed / days) * 10) / 10 },
      byWeekday: WEEKDAYS.map((d, i) => ({ label: d.label, total: grid[i].reduce((s, n) => s + n, 0), average: weekdayCount[i] ? Math.round((grid[i].reduce((s, n) => s + n, 0) / weekdayCount[i]) * 10) / 10 : 0 })),
      byLocation,
    };
  });
}

// ─────────────────────────── Retention & churn ───────────────────────────

/** A membership counts on a day when it covers that day and wasn't cancelled before it. */
const COVERS = (day: string) =>
  `ms."startDate" <= ${day} AND ms."endDate" >= ${day} AND (ms."cancelledAt" IS NULL OR (ms."cancelledAt" AT TIME ZONE $3)::date > ${day})`;

export async function retentionReport(ctx: TenantContext, range: DateRange) {
  assertReports(ctx);
  const today = todayFor(ctx);
  const months = rangeBuckets(range, "month").slice(-12);
  const ends = months.map((m) => {
    const last = monthLastDay(m);
    return last > today ? today : last;
  });
  return inTenant(ctx, async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ month: string; activeAtStart: number; retained: number; gained: number; activeAtEnd: number }[]>(
      `SELECT d.s::text AS month,
              count(*) FILTER (WHERE a.at_start)::int AS "activeAtStart",
              count(*) FILTER (WHERE a.at_start AND a.at_end)::int AS retained,
              count(*) FILTER (WHERE a.at_end AND NOT a.at_start)::int AS gained,
              count(*) FILTER (WHERE a.at_end)::int AS "activeAtEnd"
         FROM unnest($1::date[], $2::date[]) AS d(s, e)
         LEFT JOIN LATERAL (
           SELECT ms."memberId", bool_or(${COVERS("d.s")}) AS at_start, bool_or(${COVERS("d.e")}) AS at_end
             FROM "Membership" ms JOIN "Member" m ON m.id = ms."memberId"
            WHERE m."deletedAt" IS NULL AND ms."startDate" <= d.e AND ms."endDate" >= d.s
            GROUP BY ms."memberId"
         ) a ON true
        GROUP BY d.s ORDER BY d.s`,
      months,
      ends,
      ctx.gym.timezone
    );
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const series = months.map((m) => {
      const r = byMonth.get(m);
      const month: RetentionMonth = { month: m, activeAtStart: r?.activeAtStart ?? 0, retained: r?.retained ?? 0, gained: r?.gained ?? 0, activeAtEnd: r?.activeAtEnd ?? 0 };
      // A month still in progress hasn't had the chance to churn yet; it is shown "to date" but kept
      // out of the averages and the trend.
      const partial = ends[months.indexOf(m)] === today && monthLastDay(m) !== today;
      return { ...month, label: bucketLabel(m, "month") + (partial ? " (to date)" : ""), partial, ...retentionRates(month) };
    });
    const withBase = series.filter((s) => s.activeAtStart > 0 && !s.partial);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
    return {
      series,
      averageRetention: avg(withBase.map((s) => s.retentionRate!)),
      averageChurn: avg(withBase.map((s) => s.churnRate!)),
      currentMonthPartial: series.at(-1)?.partial ?? false,
    };
  });
}

// ─────────────────────────── Class popularity ───────────────────────────

export async function classReport(ctx: TenantContext, range: DateRange) {
  assertReports(ctx);
  const { start, end } = instants(ctx, range);
  return inTenant(ctx, async (tx) => {
    const rows = await tx.$queryRawUnsafe<
      { id: string; name: string; color: string; sessions: number; cancelled: number; capacity: number; booked: number; attended: number; noShow: number; waitlisted: number; fullSessions: number }[]
    >(
      `SELECT ct.id, ct.name, ct.color,
              count(*) FILTER (WHERE s.status <> 'CANCELLED')::int AS sessions,
              count(*) FILTER (WHERE s.status = 'CANCELLED')::int AS cancelled,
              coalesce(sum(s.capacity) FILTER (WHERE s.status <> 'CANCELLED'), 0)::int AS capacity,
              coalesce(sum(b.booked) FILTER (WHERE s.status <> 'CANCELLED'), 0)::int AS booked,
              coalesce(sum(b.attended) FILTER (WHERE s.status <> 'CANCELLED'), 0)::int AS attended,
              coalesce(sum(b.no_show) FILTER (WHERE s.status <> 'CANCELLED'), 0)::int AS "noShow",
              coalesce(sum(b.waitlisted) FILTER (WHERE s.status <> 'CANCELLED'), 0)::int AS waitlisted,
              count(*) FILTER (WHERE s.status <> 'CANCELLED' AND b.booked >= s.capacity)::int AS "fullSessions"
         FROM "ClassSession" s
         JOIN "ClassType" ct ON ct.id = s."classTypeId"
         CROSS JOIN LATERAL (
           SELECT count(*) FILTER (WHERE status IN ('BOOKED', 'ATTENDED', 'NO_SHOW')) AS booked,
                  count(*) FILTER (WHERE status = 'ATTENDED') AS attended,
                  count(*) FILTER (WHERE status = 'NO_SHOW') AS no_show,
                  count(*) FILTER (WHERE status = 'WAITLISTED') AS waitlisted
             FROM "Booking" WHERE "sessionId" = s.id
         ) b
        WHERE s."startsAt" >= $1 AND s."startsAt" < $2
        GROUP BY ct.id, ct.name, ct.color
        ORDER BY booked DESC, ct.name`,
      start,
      end
    );
    return rows.map((r) => ({
      ...r,
      fillRate: r.capacity ? Math.round((r.booked / r.capacity) * 1000) / 10 : null,
      // Of the bookings whose attendance was marked, how many came.
      attendanceRate: r.attended + r.noShow ? Math.round((r.attended / (r.attended + r.noShow)) * 1000) / 10 : null,
    }));
  });
}

// ─────────────────────────────── CSV export ───────────────────────────────

/**
 * Build a CSV for one report. Needs the export permission and the plan's CSV feature, and is
 * audited (kind, range, row count — never the contents), because it can contain member names.
 */
export async function exportReport(ctx: TenantContext, kind: ReportKind, range: DateRange, meta: RequestMeta): Promise<{ filename: string; csv: string; rows: number }> {
  assertReports(ctx);
  assertCan(ctx, "reports.export");
  assertFeature(ctx, "csvExport");
  const tz = ctx.gym.timezone;
  let headers: string[];
  let rows: (string | number | null)[][];

  if (kind === "revenue") {
    const { start, end } = instants(ctx, range);
    const ledger = await inTenant(ctx, (tx) =>
      tx.$queryRawUnsafe<{ receivedAt: Date; invoiceNumber: number | null; memberNumber: number; firstName: string; lastName: string; method: string; amount: number; refunded: number; status: string; plan: string | null }[]>(
        `SELECT p."receivedAt", i.number AS "invoiceNumber", m."memberNumber", m."firstName", m."lastName", p.method, p."amountMinor" AS amount,
                coalesce((SELECT sum(r."amountMinor") FROM "Refund" r WHERE r."paymentId" = p.id), 0)::int AS refunded, p.status, pl.name AS plan
           FROM "Payment" p JOIN "Member" m ON m.id = p."memberId"
           LEFT JOIN "Invoice" i ON i.id = p."invoiceId"
           LEFT JOIN "Membership" ms ON ms.id = i."membershipId"
           LEFT JOIN "MembershipPlan" pl ON pl.id = ms."planId"
          WHERE p."deletedAt" IS NULL AND p.status <> 'VOID' AND p."receivedAt" >= $1 AND p."receivedAt" < $2
          ORDER BY p."receivedAt"`,
        start,
        end
      )
    );
    headers = ["Date", "Invoice", "Member ID", "Member", "Plan", "Method", `Amount (${ctx.gym.currency})`, `Refunded (${ctx.gym.currency})`, `Net (${ctx.gym.currency})`, "Status"];
    rows = ledger.map((p) => [
      localDate(p.receivedAt, tz),
      p.invoiceNumber ? formatInvoiceNumber(p.invoiceNumber) : "",
      formatMemberNumber(p.memberNumber),
      `${p.firstName} ${p.lastName}`,
      p.plan ?? "",
      p.method,
      csvMoney(p.amount),
      csvMoney(p.refunded),
      csvMoney(p.amount - p.refunded),
      p.status,
    ]);
  } else if (kind === "attendance") {
    const r = await attendanceReport(ctx, range);
    headers = ["Weekday", "Hour", "Check-ins"];
    rows = r.grid.flatMap((row, d) => row.map((n, h) => [WEEKDAYS[d].label, `${String(h).padStart(2, "0")}:00 (${hourLabel(h)})`, n]));
  } else if (kind === "retention") {
    const r = await retentionReport(ctx, range);
    headers = ["Month", "Active at start", "Retained", "Churned", "New or returning", "Active at end", "Retention %", "Churn %"];
    rows = r.series.map((m) => [m.month.slice(0, 7), m.activeAtStart, m.retained, m.churned, m.gained, m.activeAtEnd, m.retentionRate, m.churnRate]);
  } else {
    const r = await classReport(ctx, range);
    headers = ["Class", "Sessions", "Cancelled", "Capacity", "Booked", "Fill %", "Waitlisted", "Full sessions", "Attended", "No-shows", "Attendance %"];
    rows = r.map((c) => [c.name, c.sessions, c.cancelled, c.capacity, c.booked, c.fillRate, c.waitlisted, c.fullSessions, c.attended, c.noShow, c.attendanceRate]);
  }

  await inTenant(ctx, (tx) => recordAudit(tx, ctx, { action: "report.export", entityType: "Report", entityId: kind, changes: { from: range.from, to: range.to, rows: rows.length } }, meta));
  return { filename: `${ctx.gym.slug}-${kind}-${range.from}-to-${range.to}.csv`, csv: toCsv(headers, rows), rows: rows.length };
}

/** Short human description of a range, for headings. */
export function describeRange(range: DateRange): string {
  return range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`;
}

/** Preset ranges for the picker, in the gym's calendar. */
export function rangePresets(ctx: TenantContext): { label: string; from: DateString; to: DateString }[] {
  const today = todayFor(ctx);
  const back = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10) as DateString;
  const month = monthBounds(today, ctx.gym.timezone).firstDay;
  return [
    { label: "Last 30 days", from: back(30), to: today },
    { label: "Last 90 days", from: back(90), to: today },
    { label: "This month", from: month, to: today },
    { label: "Last 12 months", from: back(365), to: today },
  ];
}
