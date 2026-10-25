import "server-only";
import { addDays, toDateString } from "@/domain/dates";
import { memberStatusOn } from "@/domain/membership";
import { formatMemberNumber } from "@/domain/member-search";
import { can } from "@/domain/permissions";
import { progressSummary } from "@/domain/progress";
import { completionRate, noShowRate, targetProgress, type PtGoal } from "@/domain/pt";
import { tryDecrypt } from "@/server/crypto";
import type { Tx } from "@/server/db/context";
import { NotFoundError } from "@/server/errors";
import { inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { coach, fullName, isTrainerOf } from "../fitness/common";
import { readEntries } from "../fitness/progress";
import { completionNote } from "../fitness/workouts";
import { todayFor } from "../members/shared";
import { assignmentsOf, readTargets } from "./assignments";
import { packagesOf } from "./packages";

/**
 * The PT client list and one client's results. Trainers see their own clients only; owners and
 * managers see every assignment in the gym. What's readable is also enforced by RLS (progress,
 * workouts and notes: managers and assigned trainers; photos: assigned trainers only).
 */

const noteCrypto = (gymId: string, id: string) => ({ gymId, model: "TrainerClientNote", field: "body", recordId: id });

type MembershipRow = { id: string; status: "ACTIVE" | "FROZEN" | "CANCELLED" | "EXPIRED"; startDate: Date; endDate: Date; cancelledAt: Date | null; freezes: { startDate: Date; endDate: Date }[] };

function statusOf(memberships: MembershipRow[], today: string) {
  return memberStatusOn(
    memberships.map((m) => ({ ...m, startDate: toDateString(m.startDate), endDate: toDateString(m.endDate), freezes: m.freezes.map((f) => ({ startDate: toDateString(f.startDate), endDate: toDateString(f.endDate) })) })),
    today
  );
}

const MEMBERSHIPS = { orderBy: { endDate: "desc" as const }, take: 5, select: { id: true, status: true, startDate: true, endDate: true, cancelledAt: true, freezes: { select: { startDate: true, endDate: true } } } };

export async function listTrainers(ctx: TenantContext) {
  return inTenant(ctx, async (tx) => {
    const rows = await tx.staffMember.findMany({
      where: { status: "ACTIVE", role: "TRAINER" },
      select: { id: true, specialties: true, user: { select: { name: true } }, _count: { select: { clients: true } } },
    });
    return rows.map((t) => ({ id: t.id, name: t.user.name, specialties: t.specialties, clients: t._count.clients })).sort((a, b) => a.name.localeCompare(b.name));
  });
}

export type ClientFilters = { trainerId?: string; goal?: PtGoal; q?: string };

export async function listPtClients(ctx: TenantContext, f: ClientFilters) {
  const c = coach(ctx);
  const isManager = can(ctx.role, "pt.manage");
  const today = todayFor(ctx);
  const trainerId = isManager ? f.trainerId || undefined : c.staffId;
  const q = f.q?.trim().toLowerCase() ?? "";
  return inTenant(ctx, async (tx) => {
    const rows = await tx.trainerClient.findMany({
      where: { ...(trainerId ? { trainerId } : {}), ...(f.goal ? { goal: f.goal } : {}), member: { deletedAt: null } },
      select: {
        id: true,
        goal: true,
        startedOn: true,
        trainerId: true,
        trainer: { select: { user: { select: { name: true } } } },
        member: { select: { id: true, firstName: true, lastName: true, memberNumber: true, memberships: MEMBERSHIPS } },
      },
    });
    const memberIds = [...new Set(rows.map((r) => r.member.id))];
    const now = new Date();
    const [last, next, done30, measured] = await Promise.all([
      tx.trainingSession.groupBy({ by: ["memberId"], where: { memberId: { in: memberIds }, status: "COMPLETED" }, _max: { startsAt: true } }),
      tx.trainingSession.groupBy({ by: ["memberId"], where: { memberId: { in: memberIds }, status: "SCHEDULED", startsAt: { gte: now } }, _min: { startsAt: true } }),
      tx.trainingSession.groupBy({ by: ["memberId"], where: { memberId: { in: memberIds }, status: "COMPLETED", startsAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }, _count: { _all: true } }),
      tx.progressEntry.groupBy({ by: ["memberId"], where: { memberId: { in: memberIds } }, _max: { recordedOn: true } }),
    ]);
    const lastBy = new Map(last.map((r) => [r.memberId, r._max.startsAt]));
    const nextBy = new Map(next.map((r) => [r.memberId, r._min.startsAt]));
    const doneBy = new Map(done30.map((r) => [r.memberId, r._count._all]));
    const measuredBy = new Map(measured.map((r) => [r.memberId, r._max.recordedOn]));

    const byMember = new Map<string, { member: (typeof rows)[number]["member"]; trainers: { assignmentId: string; id: string; name: string; goal: PtGoal | null; startedOn: string }[] }>();
    for (const r of rows) {
      const entry = byMember.get(r.member.id) ?? { member: r.member, trainers: [] };
      entry.trainers.push({ assignmentId: r.id, id: r.trainerId, name: r.trainer.user.name, goal: r.goal, startedOn: toDateString(r.startedOn) });
      byMember.set(r.member.id, entry);
    }
    const clients = [...byMember.values()]
      .map(({ member: m, trainers }) => {
        const lastSession = lastBy.get(m.id) ?? null;
        const nextSession = nextBy.get(m.id) ?? null;
        const since = trainers.map((t) => t.startedOn).sort()[0];
        // Needs attention: no session in 3 weeks and none booked (ignoring brand-new clients).
        const idle = !nextSession && (!lastSession || lastSession.getTime() < now.getTime() - 21 * 86_400_000) && since < addDays(today, -7);
        return {
          memberId: m.id,
          name: fullName(m),
          memberNumber: formatMemberNumber(m.memberNumber),
          status: statusOf(m.memberships, today),
          trainers: trainers.sort((a, b) => a.name.localeCompare(b.name)),
          since,
          lastSession,
          nextSession,
          sessions30d: doneBy.get(m.id) ?? 0,
          lastMeasuredOn: measuredBy.get(m.id) ? toDateString(measuredBy.get(m.id)!) : null,
          needsAttention: idle,
        };
      })
      .filter((cl) => !q || cl.name.toLowerCase().includes(q) || cl.memberNumber.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { clients, isManager };
  });
}

async function assertCanView(tx: Tx, ctx: TenantContext, memberId: string) {
  const c = coach(ctx);
  const member = await tx.member.findFirst({
    where: { id: memberId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, memberNumber: true, joinedAt: true, memberships: { ...MEMBERSHIPS, select: { ...MEMBERSHIPS.select, plan: { select: { name: true } } } } },
  });
  // Not your client: the same answer as a member that doesn't exist.
  if (!member) throw new NotFoundError("Member not found.");
  const mine = await isTrainerOf(tx, c, memberId);
  if (!can(ctx.role, "pt.manage") && !mine) throw new NotFoundError("Member not found.");
  return { c, member, mine };
}

/** One client's PT picture: trainers and goals, progress toward targets, workouts, sessions, notes. */
export async function ptClient(ctx: TenantContext, memberId: string) {
  const today = todayFor(ctx);
  const gymId = ctx.gym.id;
  return inTenant(ctx, async (tx) => {
    const { c, member, mine } = await assertCanView(tx, ctx, memberId);
    const fourWeeksAgo = new Date(Date.now() - 28 * 86_400_000);
    const [assignments, history, entries, plans, completions, completions28, sessions, sessionCounts, notes, photoCount, packages] = await Promise.all([
      assignmentsOf(tx, gymId, memberId),
      tx.ptAssignmentHistory.findMany({
        where: { memberId },
        orderBy: { endedAt: "desc" },
        take: 20,
        select: { id: true, goal: true, targetsEnc: true, startedOn: true, endedAt: true, endReason: true, trainer: { select: { user: { select: { name: true } } } } },
      }),
      readEntries(tx, gymId, memberId),
      tx.workoutPlan.findMany({ where: { memberId }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 10, select: { id: true, title: true, status: true, updatedAt: true, _count: { select: { days: true } } } }),
      tx.workoutCompletion.findMany({ where: { memberId }, orderBy: { completedAt: "desc" }, take: 10, select: { id: true, completedAt: true, noteEnc: true, day: { select: { title: true, plan: { select: { title: true } } } } } }),
      tx.workoutCompletion.count({ where: { memberId, completedAt: { gte: fourWeeksAgo } } }),
      tx.trainingSession.findMany({
        where: { memberId, startsAt: { gte: new Date(Date.now() - 120 * 86_400_000) } },
        orderBy: { startsAt: "desc" },
        take: 40,
        select: { id: true, startsAt: true, endsAt: true, status: true, focus: true, trainerId: true, complimentary: true, deliveryMode: true, purchase: { select: { name: true } }, trainer: { select: { user: { select: { name: true } } } } },
      }),
      tx.trainingSession.groupBy({ by: ["status"], where: { memberId }, _count: { _all: true } }),
      tx.trainerClientNote.findMany({ where: { memberId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, bodyEnc: true, createdAt: true, authorId: true, author: { select: { user: { select: { name: true } } } } } }),
      // Photos are private to the member and assigned trainers (RLS); others get no count either.
      mine ? tx.progressPhoto.count({ where: { memberId } }) : Promise.resolve(null),
      packagesOf(tx, memberId, today),
    ]);

    const activeDays = plans.filter((p) => p.status === "ACTIVE").reduce((n, p) => n + p._count.days, 0);
    const counts = Object.fromEntries(sessionCounts.map((r) => [r.status, r._count._all])) as Partial<Record<"SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW", number>>;
    const isManager = can(ctx.role, "pt.manage");
    const now = Date.now();
    return {
      member: {
        id: member.id,
        name: fullName(member),
        memberNumber: formatMemberNumber(member.memberNumber),
        joinedAt: member.joinedAt,
        status: statusOf(member.memberships, today),
        membership: member.memberships.find((m) => m.status === "ACTIVE" && toDateString(m.endDate) >= today)?.plan.name ?? null,
      },
      assignments: assignments.map((a) => ({ ...a, progress: targetProgress(entries, a.targets, a.startedOn), mine: a.trainerId === c.staffId })),
      history: history.map((h) => ({
        id: h.id,
        trainerName: h.trainer.user.name,
        goal: h.goal,
        targets: readTargets(gymId, "PtAssignmentHistory", h.id, h.targetsEnc),
        startedOn: toDateString(h.startedOn),
        endedAt: h.endedAt,
        endReason: h.endReason,
      })),
      progress: { entries, summary: progressSummary(entries) },
      workouts: {
        plans: plans.map((p) => ({ id: p.id, title: p.title, status: p.status, dayCount: p._count.days, updatedAt: p.updatedAt })),
        last28Days: completions28,
        // Each day of an active plan is meant to be done once a week.
        plannedLast28Days: activeDays * 4,
        completionRate: completionRate(completions28, activeDays * 4),
        recent: completions.map((x) => ({ id: x.id, completedAt: x.completedAt, plan: x.day.plan.title, day: x.day.title, note: completionNote(gymId, x.id, x.noteEnc) })),
      },
      sessions: {
        upcoming: sessions.filter((s) => s.status === "SCHEDULED" && s.startsAt.getTime() >= now).reverse(),
        past: sessions.filter((s) => !(s.status === "SCHEDULED" && s.startsAt.getTime() >= now)).slice(0, 20),
        counts: { completed: counts.COMPLETED ?? 0, noShow: counts.NO_SHOW ?? 0, cancelled: counts.CANCELLED ?? 0, scheduled: counts.SCHEDULED ?? 0 },
        noShowRate: noShowRate(counts.COMPLETED ?? 0, counts.NO_SHOW ?? 0),
      },
      notes: notes.flatMap((n) => {
        const body = tryDecrypt(n.bodyEnc, noteCrypto(gymId, n.id));
        return body === null ? [] : [{ id: n.id, body, author: n.author.user.name, mine: n.authorId === c.staffId, createdAt: n.createdAt }];
      }),
      photoCount,
      packages,
      creditsLeft: packages.filter((p) => p.state === "active" || p.state === "upcoming").reduce((n, p) => n + p.remaining, 0),
      viewer: { isManager, isTrainer: mine, staffId: c.staffId },
    };
  });
}
