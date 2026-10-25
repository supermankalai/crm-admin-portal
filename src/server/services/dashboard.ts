import "server-only";
import { addDays, dayBounds, monthBounds, toDateString, type DateString } from "@/domain/dates";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { todayFor } from "./members/shared";

/**
 * Gym dashboard figures, all from live queries in the gym's RLS context and the gym's time zone.
 * Revenue is net of refunds. "Active" mirrors domain/membership.ts (covers today, not frozen,
 * not cancelled).
 */

const ACTIVE_ON = (alias: string, day: string) => `
  ${alias}.status IN ('ACTIVE', 'FROZEN') AND ${alias}."startDate" <= ${day} AND ${alias}."endDate" >= ${day}
  AND NOT EXISTS (SELECT 1 FROM "MembershipFreeze" f WHERE f."membershipId" = ${alias}.id AND f."startDate" <= ${day} AND f."endDate" >= ${day})`;

/** Last calendar day of the month containing a "YYYY-MM-01" date. */
function monthEnd(firstDay: DateString): DateString {
  const [y, m] = firstDay.split("-").map(Number);
  return toDateString(new Date(Date.UTC(y, m, 0)));
}

function lastMonths(today: DateString, count: number): DateString[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return toDateString(d);
  });
}

export async function getDashboard(ctx: TenantContext) {
  assertCan(ctx, "dashboard.view");
  const tz = ctx.gym.timezone;
  const today = todayFor(ctx);
  const day = dayBounds(today, tz);
  const month = monthBounds(today, tz);
  const financials = ctx.permissions.has("dashboard.financials");
  const ownClassesOnly = !ctx.permissions.has("classes.manage") && ctx.permissions.has("classes.manageOwn");
  const months = lastMonths(today, 6);
  const sixMonthsStart = monthBounds(months[0], tz).start;

  return inTenant(ctx, async (tx) => {
    // Queries run sequentially: they share the transaction's single connection.
    const [{ active }] = await tx.$queryRawUnsafe<{ active: number }[]>(
      `SELECT count(DISTINCT s."memberId")::int AS active FROM "Membership" s JOIN "Member" m ON m.id = s."memberId"
        WHERE m."deletedAt" IS NULL AND ${ACTIVE_ON("s", "$1::date")}`,
      today
    );

    const newThisMonth = await tx.member.count({ where: { deletedAt: null, joinedAt: { gte: month.start, lt: month.end } } });
    const checkInsToday = await tx.checkIn.count({ where: { result: "ALLOWED", checkedInAt: { gte: day.start, lt: day.end } } });

    // Expiring in the next 7 days and not already renewed by a later membership. Staff without
    // members.viewAll (trainers) only see their own assigned clients, as everywhere else.
    const ownClientsOnly = !ctx.permissions.has("members.viewAll");
    const expiring = await tx.$queryRawUnsafe<{ membershipId: string; memberId: string; name: string; plan: string; endDate: Date }[]>(
      `SELECT s.id AS "membershipId", m.id AS "memberId", m."firstName" || ' ' || m."lastName" AS name, p.name AS plan, s."endDate"
         FROM "Membership" s JOIN "Member" m ON m.id = s."memberId" JOIN "MembershipPlan" p ON p.id = s."planId"
        WHERE m."deletedAt" IS NULL AND ${ACTIVE_ON("s", "$1::date")} AND s."endDate" <= $2::date
          AND NOT EXISTS (SELECT 1 FROM "Membership" n WHERE n."memberId" = s."memberId" AND n.id <> s.id
                          AND n."startDate" > s."startDate" AND n.status <> 'CANCELLED')
          AND (NOT $3::boolean OR EXISTS (SELECT 1 FROM "TrainerClient" tc WHERE tc."memberId" = m.id AND tc."trainerId" = $4))
        ORDER BY s."endDate", name`,
      today,
      addDays(today, 7),
      ownClientsOnly,
      ctx.staffId ?? "__none__"
    );

    const sessionWhere = { startsAt: { gte: new Date() }, status: "SCHEDULED" as const, ...(ownClassesOnly ? { trainerId: ctx.staffId ?? "__none__" } : {}) };
    const upcomingClasses = await tx.classSession.findMany({
      where: sessionWhere,
      orderBy: { startsAt: "asc" },
      take: 6,
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        classType: { select: { name: true, color: true } },
        room: { select: { name: true } },
        trainer: { select: { user: { select: { name: true } } } },
        _count: { select: { bookings: { where: { status: "BOOKED" } } } },
      },
    });

    let revenue: { today: number; month: number; trend: { month: DateString; netMinor: number }[] } | null = null;
    if (financials) {
      const sumPayments = async (from: Date, to: Date) =>
        (await tx.payment.aggregate({ _sum: { amountMinor: true }, where: { deletedAt: null, status: { not: "VOID" }, receivedAt: { gte: from, lt: to } } }))._sum.amountMinor ?? 0;
      const sumRefunds = async (from: Date, to: Date) =>
        (await tx.refund.aggregate({ _sum: { amountMinor: true }, where: { refundedAt: { gte: from, lt: to } } }))._sum.amountMinor ?? 0;
      const todayNet = (await sumPayments(day.start, day.end)) - (await sumRefunds(day.start, day.end));
      const monthNet = (await sumPayments(month.start, month.end)) - (await sumRefunds(month.start, month.end));

      const paid = await tx.$queryRawUnsafe<{ m: string; total: bigint }[]>(
        `SELECT to_char(date_trunc('month', "receivedAt" AT TIME ZONE $1), 'YYYY-MM-01') AS m, sum("amountMinor")::bigint AS total
           FROM "Payment" WHERE "deletedAt" IS NULL AND status <> 'VOID' AND "receivedAt" >= $2 GROUP BY 1`,
        tz,
        sixMonthsStart
      );
      const refunded = await tx.$queryRawUnsafe<{ m: string; total: bigint }[]>(
        `SELECT to_char(date_trunc('month', "refundedAt" AT TIME ZONE $1), 'YYYY-MM-01') AS m, sum("amountMinor")::bigint AS total
           FROM "Refund" WHERE "refundedAt" >= $2 GROUP BY 1`,
        tz,
        sixMonthsStart
      );
      const paidBy = new Map(paid.map((r) => [r.m, Number(r.total)]));
      const refundedBy = new Map(refunded.map((r) => [r.m, Number(r.total)]));
      revenue = {
        today: todayNet,
        month: monthNet,
        trend: months.map((m) => ({ month: m, netMinor: (paidBy.get(m) ?? 0) - (refundedBy.get(m) ?? 0) })),
      };
    }

    // Membership growth: active members at each month end (today for the current month) + sign-ups per month.
    const snapshotDays = months.map((m, i) => (i === months.length - 1 ? today : monthEnd(m)));
    const growthRows = await tx.$queryRawUnsafe<{ day: string; active: number }[]>(
      `SELECT d::text AS day,
              (SELECT count(DISTINCT s."memberId") FROM "Membership" s JOIN "Member" m ON m.id = s."memberId"
                WHERE m."deletedAt" IS NULL AND s.status IN ('ACTIVE', 'FROZEN') AND s."startDate" <= d AND s."endDate" >= d)::int AS active
         FROM unnest($1::date[]) AS d`,
      snapshotDays
    );
    const joins = await tx.$queryRawUnsafe<{ m: string; n: number }[]>(
      `SELECT to_char(date_trunc('month', "joinedAt" AT TIME ZONE $1), 'YYYY-MM-01') AS m, count(*)::int AS n
         FROM "Member" WHERE "deletedAt" IS NULL AND "joinedAt" >= $2 GROUP BY 1`,
      tz,
      sixMonthsStart
    );
    const joinsBy = new Map(joins.map((r) => [r.m, r.n]));
    const activeByDay = new Map(growthRows.map((r) => [r.day, r.active]));

    const myClients = ownClassesOnly && ctx.staffId ? await tx.trainerClient.count({ where: { trainerId: ctx.staffId, member: { deletedAt: null } } }) : null;

    return {
      today,
      activeMembers: active,
      newThisMonth,
      checkInsToday,
      expiring: expiring.map((e) => ({ ...e, endDate: toDateString(e.endDate) })),
      upcomingClasses,
      revenue,
      growth: months.map((m, i) => ({ month: m, activeMembers: activeByDay.get(snapshotDays[i]) ?? 0, newMembers: joinsBy.get(m) ?? 0 })),
      myClients,
      ownClassesOnly,
    };
  });
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
