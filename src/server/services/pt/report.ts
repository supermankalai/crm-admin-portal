import "server-only";
import { dayBounds } from "@/domain/dates";
import { noShowRate } from "@/domain/pt";
import type { DateRange } from "@/domain/reports";
import { inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";

/**
 * Trainer performance for a date range (Reports → Trainers): clients now, clients gained and
 * lost, PT sessions done / missed / cancelled, and PT package sales credited to the trainer
 * (packages sold for sessions with them). Callers check reports access first.
 */
export async function trainerReport(ctx: TenantContext, range: DateRange) {
  const start = dayBounds(range.from, ctx.gym.timezone).start;
  const end = dayBounds(range.to, ctx.gym.timezone).end;
  return inTenant(ctx, async (tx) => {
    const [trainers, clientsNow, gained, lost, sessions, sales] = await Promise.all([
      tx.staffMember.findMany({ where: { role: "TRAINER", OR: [{ status: "ACTIVE" }, { removedAt: { gte: start } }] }, select: { id: true, status: true, user: { select: { name: true } } } }),
      tx.trainerClient.groupBy({ by: ["trainerId"], where: { member: { deletedAt: null } }, _count: { _all: true } }),
      // New: assignments started in the range (still open, or since ended).
      tx.$queryRaw<{ trainerId: string; n: number }[]>`
        SELECT "trainerId", count(*)::int AS n FROM (
          SELECT "trainerId", "createdAt" FROM "TrainerClient"
          UNION ALL SELECT "trainerId", "startedOn"::timestamptz FROM "PtAssignmentHistory") a
         WHERE "createdAt" >= ${start} AND "createdAt" < ${end} GROUP BY "trainerId"`,
      tx.ptAssignmentHistory.groupBy({ by: ["trainerId"], where: { endedAt: { gte: start, lt: end } }, _count: { _all: true } }),
      tx.trainingSession.groupBy({ by: ["trainerId", "status"], where: { startsAt: { gte: start, lt: end } }, _count: { _all: true } }),
      tx.$queryRaw<{ trainerId: string; n: number; revenue: number }[]>`
        SELECT p."trainerId", count(*)::int AS n, coalesce(sum(i."totalMinor"), 0)::int AS revenue
          FROM "PtPackagePurchase" p JOIN "Invoice" i ON i.id = p."invoiceId"
         WHERE p."trainerId" IS NOT NULL AND i.status <> 'VOID' AND p."cancelledAt" IS NULL
           AND p."createdAt" >= ${start} AND p."createdAt" < ${end}
         GROUP BY p."trainerId"`,
    ]);
    const by = <T extends { trainerId: string }>(rows: T[]) => new Map(rows.map((r) => [r.trainerId, r]));
    const now = by(clientsNow);
    const gain = by(gained);
    const loss = by(lost);
    const sale = by(sales);
    const rows = trainers
      .map((t) => {
        const count = (status: string) => sessions.find((s) => s.trainerId === t.id && s.status === status)?._count._all ?? 0;
        const completed = count("COMPLETED");
        const noShows = count("NO_SHOW");
        return {
          id: t.id,
          name: t.user.name,
          active: t.status === "ACTIVE",
          clients: now.get(t.id)?._count._all ?? 0,
          newClients: gain.get(t.id)?.n ?? 0,
          endedClients: loss.get(t.id)?._count._all ?? 0,
          completed,
          noShows,
          cancelled: count("CANCELLED"),
          booked: count("SCHEDULED"),
          noShowRate: noShowRate(completed, noShows),
          packagesSold: sale.get(t.id)?.n ?? 0,
          packageRevenueMinor: sale.get(t.id)?.revenue ?? 0,
        };
      })
      .sort((a, b) => b.completed - a.completed || b.clients - a.clients || a.name.localeCompare(b.name));
    const sum = (k: "clients" | "completed" | "noShows" | "cancelled" | "packagesSold" | "packageRevenueMinor") => rows.reduce((n, r) => n + r[k], 0);
    // Packages sold for any trainer aren't credited to one: show them in the totals.
    const unassigned = await tx.$queryRaw<{ n: number; revenue: number }[]>`
      SELECT count(*)::int AS n, coalesce(sum(i."totalMinor"), 0)::int AS revenue
        FROM "PtPackagePurchase" p JOIN "Invoice" i ON i.id = p."invoiceId"
       WHERE p."trainerId" IS NULL AND i.status <> 'VOID' AND p."cancelledAt" IS NULL
         AND p."createdAt" >= ${start} AND p."createdAt" < ${end}`;
    return {
      rows,
      totals: {
        clients: sum("clients"),
        completed: sum("completed"),
        noShows: sum("noShows"),
        cancelled: sum("cancelled"),
        noShowRate: noShowRate(sum("completed"), sum("noShows")),
        packagesSold: sum("packagesSold") + (unassigned[0]?.n ?? 0),
        packageRevenueMinor: sum("packageRevenueMinor") + (unassigned[0]?.revenue ?? 0),
        anyTrainerPackages: unassigned[0]?.n ?? 0,
      },
    };
  });
}
