import "server-only";
import { addDays, dayBounds, toDateString } from "@/domain/dates";
import { can } from "@/domain/permissions";
import { noShowRate, type PtGoal } from "@/domain/pt";
import { inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { coach, fullName } from "../fitness/common";
import { todayFor } from "../members/shared";

/**
 * The PT module's front page. Owners and managers see the whole gym (per-trainer table); a trainer
 * sees the same numbers for their own clients only.
 */

/** Monday of the week containing `date` (YYYY-MM-DD). */
function mondayOf(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export async function ptOverview(ctx: TenantContext) {
  const c = coach(ctx);
  const isManager = can(ctx.role, "pt.manage");
  const tz = ctx.gym.timezone;
  const today = todayFor(ctx);
  const week = { start: dayBounds(mondayOf(today), tz).start, end: dayBounds(addDays(mondayOf(today), 6), tz).end };
  const monthStart = dayBounds(`${today.slice(0, 8)}01`, tz).start;
  const now = new Date();
  const scope = isManager ? {} : { trainerId: c.staffId };

  return inTenant(ctx, async (tx) => {
    const [assignments, weekByStatus, monthByTrainer, upcoming, trainers, recentEnded] = await Promise.all([
      tx.trainerClient.findMany({
        where: { ...scope, member: { deletedAt: null } },
        orderBy: { createdAt: "desc" },
        select: { id: true, trainerId: true, memberId: true, goal: true, startedOn: true, createdAt: true, member: { select: { firstName: true, lastName: true } }, trainer: { select: { user: { select: { name: true } } } } },
      }),
      tx.trainingSession.groupBy({ by: ["status"], where: { ...scope, startsAt: { gte: week.start, lt: week.end } }, _count: { _all: true } }),
      tx.trainingSession.groupBy({ by: ["trainerId", "status"], where: { ...scope, startsAt: { gte: monthStart, lt: now } }, _count: { _all: true } }),
      tx.trainingSession.findMany({
        where: { ...scope, status: "SCHEDULED", startsAt: { gte: now, lt: new Date(now.getTime() + 7 * 86_400_000) } },
        orderBy: { startsAt: "asc" },
        take: 12,
        select: { id: true, startsAt: true, endsAt: true, focus: true, trainer: { select: { user: { select: { name: true } } } }, member: { select: { id: true, firstName: true, lastName: true } } },
      }),
      isManager
        ? tx.staffMember.findMany({ where: { status: "ACTIVE", role: "TRAINER" }, select: { id: true, user: { select: { name: true } } } })
        : Promise.resolve([] as { id: string; user: { name: string } }[]),
      tx.ptAssignmentHistory.findMany({
        where: { ...scope, endedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
        orderBy: { endedAt: "desc" },
        take: 5,
        select: { id: true, endedAt: true, endReason: true, member: { select: { id: true, firstName: true, lastName: true } }, trainer: { select: { user: { select: { name: true } } } } },
      }),
    ]);

    // Clients whose last PT session (with anyone) is over 3 weeks ago and who have nothing booked.
    const memberIds = [...new Set(assignments.map((a) => a.memberId))];
    const [lastDone, nextBooked] = await Promise.all([
      tx.trainingSession.groupBy({ by: ["memberId"], where: { memberId: { in: memberIds }, status: "COMPLETED" }, _max: { startsAt: true } }),
      tx.trainingSession.groupBy({ by: ["memberId"], where: { memberId: { in: memberIds }, status: "SCHEDULED", startsAt: { gte: now } }, _count: { _all: true } }),
    ]);
    const lastBy = new Map(lastDone.map((r) => [r.memberId, r._max.startsAt]));
    const booked = new Set(nextBooked.map((r) => r.memberId));
    const settled = addDays(today, -7);
    const needsAttention = assignments
      .filter((a) => !booked.has(a.memberId) && toDateString(a.startedOn) < settled)
      .filter((a) => {
        const last = lastBy.get(a.memberId);
        return !last || last.getTime() < now.getTime() - 21 * 86_400_000;
      })
      .map((a) => ({ memberId: a.memberId, name: fullName(a.member), trainer: a.trainer.user.name, lastSession: lastBy.get(a.memberId) ?? null }))
      .filter((a, i, all) => all.findIndex((b) => b.memberId === a.memberId) === i)
      .slice(0, 8);

    const weekCounts = Object.fromEntries(weekByStatus.map((r) => [r.status, r._count._all])) as Partial<Record<string, number>>;
    const perTrainer = new Map<string, { completed: number; noShow: number; cancelled: number }>();
    for (const r of monthByTrainer) {
      const t = perTrainer.get(r.trainerId) ?? { completed: 0, noShow: 0, cancelled: 0 };
      if (r.status === "COMPLETED") t.completed += r._count._all;
      if (r.status === "NO_SHOW") t.noShow += r._count._all;
      if (r.status === "CANCELLED") t.cancelled += r._count._all;
      perTrainer.set(r.trainerId, t);
    }
    const clientsBy = new Map<string, number>();
    for (const a of assignments) clientsBy.set(a.trainerId, (clientsBy.get(a.trainerId) ?? 0) + 1);
    const goals = new Map<PtGoal | "NONE", number>();
    for (const a of assignments) goals.set(a.goal ?? "NONE", (goals.get(a.goal ?? "NONE") ?? 0) + 1);

    return {
      isManager,
      totals: {
        clients: memberIds.length,
        trainersWithClients: new Set(assignments.map((a) => a.trainerId)).size,
        trainers: isManager ? trainers.length : 1,
        newThisMonth: assignments.filter((a) => a.createdAt >= monthStart).length,
        week: { scheduled: weekCounts.SCHEDULED ?? 0, completed: weekCounts.COMPLETED ?? 0, noShow: weekCounts.NO_SHOW ?? 0, cancelled: weekCounts.CANCELLED ?? 0 },
      },
      trainers: trainers
        .map((t) => {
          const m = perTrainer.get(t.id) ?? { completed: 0, noShow: 0, cancelled: 0 };
          return { id: t.id, name: t.user.name, clients: clientsBy.get(t.id) ?? 0, completedThisMonth: m.completed, noShowsThisMonth: m.noShow, noShowRate: noShowRate(m.completed, m.noShow) };
        })
        .sort((a, b) => b.clients - a.clients || a.name.localeCompare(b.name)),
      goals: [...goals.entries()].map(([goal, count]) => ({ goal, count })).sort((a, b) => b.count - a.count),
      upcoming: upcoming.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, focus: s.focus, trainer: s.trainer.user.name, member: { id: s.member.id, name: fullName(s.member) } })),
      needsAttention,
      recentAssignments: assignments.slice(0, 5).map((a) => ({ id: a.id, memberId: a.memberId, name: fullName(a.member), trainer: a.trainer.user.name, goal: a.goal, at: a.createdAt })),
      recentEnded: recentEnded.map((h) => ({ id: h.id, memberId: h.member.id, name: fullName(h.member), trainer: h.trainer.user.name, at: h.endedAt, reason: h.endReason })),
    };
  });
}
