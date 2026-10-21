import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { addDays, dayBounds, isDateString, toDateString } from "@/domain/dates";
import { recordAudit } from "@/server/audit/tenant-audit";
import { encryptField, tryDecrypt } from "@/server/crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertWritable, inTenant } from "@/server/tenant/guards";
import { inMember, type MemberContext } from "@/server/tenant/member";
import type { TenantContext } from "@/server/tenant/types";
import { markAttendance } from "../classes/bookings";
import { getMemberProfile } from "../members/profile";
import { todayFor } from "../members/shared";
import { formatMemberNumber } from "@/domain/member-search";
import { memberStatusOn } from "@/domain/membership";
import { assertCanCoach, coach, fullName, isTrainerOf } from "./common";
import { bookSession, closeSession } from "../pt/sessions";
import { readEntries, readPhotos } from "./progress";
import { completionNote, planRow, planRowsFor, staffNamesForMember } from "./workouts";

/**
 * The trainer's side of the app: their schedule (classes, PT sessions, shifts), class attendance,
 * their clients, private notes and personal training sessions.
 */

const noteCrypto = (gymId: string, id: string) => ({ gymId, model: "TrainerClientNote", field: "body", recordId: id });

function range(ctx: TenantContext, query: { from?: string; to?: string }) {
  const today = todayFor(ctx);
  const from = query.from && isDateString(query.from) ? query.from : today;
  let to = query.to && isDateString(query.to) ? query.to : addDays(from, 6);
  if (to < from) throw new ValidationError("Choose a valid date range.");
  if (to > addDays(from, 31)) to = addDays(from, 31);
  return { from, to, start: dayBounds(from, ctx.gym.timezone).start, end: dayBounds(to, ctx.gym.timezone).end };
}

// ─────────────────────────────── Schedule & attendance ───────────────────────────────

export async function trainerSchedule(ctx: TenantContext, query: { from?: string; to?: string }) {
  if (!ctx.staffId) throw new ForbiddenError("Only gym staff have a schedule.");
  const staffId = ctx.staffId;
  const r = range(ctx, query);
  // Anything overlapping the range — including a class still running just after midnight.
  const overlaps = { startsAt: { lt: r.end }, endsAt: { gt: r.start } };
  return inTenant(ctx, async (tx) => {
    const [classes, pts, shifts] = await Promise.all([
      tx.classSession.findMany({
        where: { trainerId: staffId, ...overlaps },
        select: { id: true, startsAt: true, endsAt: true, status: true, capacity: true, classType: { select: { name: true, color: true } }, room: { select: { name: true } }, bookings: { where: { status: { in: ["BOOKED", "ATTENDED", "NO_SHOW"] } }, select: { id: true } } },
      }),
      tx.trainingSession.findMany({ where: { trainerId: staffId, ...overlaps }, select: { id: true, startsAt: true, endsAt: true, status: true, focus: true, member: { select: { id: true, firstName: true, lastName: true } } } }),
      tx.staffShift.findMany({ where: { staffId, ...overlaps }, select: { id: true, startsAt: true, endsAt: true, location: { select: { name: true } } } }),
    ]);
    const items = [
      ...classes.map((c) => ({ kind: "class" as const, id: c.id, startsAt: c.startsAt, endsAt: c.endsAt, title: c.classType.name, color: c.classType.color, room: c.room?.name ?? "Online", booked: c.bookings.length, capacity: c.capacity, status: c.status })),
      ...pts.map((p) => ({ kind: "pt" as const, id: p.id, startsAt: p.startsAt, endsAt: p.endsAt, member: { id: p.member.id, name: fullName(p.member) }, focus: p.focus, status: p.status })),
      ...shifts.map((s) => ({ kind: "shift" as const, id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, location: s.location.name })),
    ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.kind === "shift" ? -1 : 1));
    return { from: r.from, to: r.to, items: items.map((i) => ({ ...i, startsAt: i.startsAt.toISOString(), endsAt: i.endsAt.toISOString() })) };
  });
}

export async function trainerAttendance(ctx: TenantContext, bookingId: string, attended: boolean, meta: RequestMeta) {
  assertWritable(ctx);
  return markAttendance(ctx, bookingId, attended, meta) as Promise<{ status: "ATTENDED" | "NO_SHOW" }>;
}

// ─────────────────────────────── Clients ───────────────────────────────

export async function trainerClients(ctx: TenantContext) {
  const c = coach(ctx);
  const today = todayFor(ctx);
  return inTenant(ctx, async (tx) => {
    const rows = await tx.trainerClient.findMany({
      where: { trainerId: c.staffId, member: { deletedAt: null } },
      select: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            memberNumber: true,
            memberships: { orderBy: { endDate: "desc" }, take: 5, select: { id: true, status: true, startDate: true, endDate: true, cancelledAt: true, freezes: { select: { startDate: true, endDate: true } } } },
            checkIns: { where: { result: "ALLOWED" }, orderBy: { checkedInAt: "desc" }, take: 1, select: { checkedInAt: true } },
            workoutPlans: { where: { status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: 1, select: { title: true } },
            trainingSessions: { where: { trainerId: c.staffId, status: "SCHEDULED", startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } },
          },
        },
      },
    });
    const clients = rows
      .map(({ member: m }) => ({
        memberId: m.id,
        name: fullName(m),
        memberNumber: formatMemberNumber(m.memberNumber),
        status: memberStatusOn(m.memberships.map(toRecord), today),
        lastVisit: m.checkIns[0]?.checkedInAt.toISOString() ?? null,
        activePlan: m.workoutPlans[0]?.title ?? null,
        nextSession: m.trainingSessions[0]?.startsAt.toISOString() ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { clients };
  });
}

function toRecord(m: { id: string; status: "ACTIVE" | "FROZEN" | "CANCELLED" | "EXPIRED"; startDate: Date; endDate: Date; cancelledAt: Date | null; freezes: { startDate: Date; endDate: Date }[] }) {
  return { ...m, startDate: toDateString(m.startDate), endDate: toDateString(m.endDate), freezes: m.freezes.map((f) => ({ startDate: toDateString(f.startDate), endDate: toDateString(f.endDate) })) };
}

/**
 * One client. Trainers only for their own clients; managers and owners for anyone. Photos are
 * listed only for an assigned trainer (RLS hides them from everyone else) and the viewing is audited.
 */
export async function trainerClient(ctx: TenantContext, memberId: string, meta: RequestMeta) {
  const c = coach(ctx);
  const mine = await inTenant(ctx, async (tx) => {
    await assertCanCoach(tx, c, memberId).catch((e) => {
      // Not your client: the same answer as a member that doesn't exist.
      throw e instanceof ForbiddenError ? new NotFoundError("Member not found.") : e;
    });
    return isTrainerOf(tx, c, memberId);
  });
  const profile = await getMemberProfile(ctx, memberId);
  return inTenant(ctx, async (tx) => {
    const [plans, completions, progress, photos, notes, sessions, lastVisit] = await Promise.all([
      planRowsFor(tx, { memberId }),
      tx.workoutCompletion.findMany({
        where: { memberId },
        orderBy: { completedAt: "desc" },
        take: 15,
        select: { id: true, completedAt: true, noteEnc: true, day: { select: { title: true, plan: { select: { title: true } } } } },
      }),
      readEntries(tx, ctx.gym.id, memberId),
      mine ? readPhotos(tx, { userId: ctx.user.id, gymId: ctx.gym.id }, memberId, 30) : Promise.resolve(null),
      tx.trainerClientNote.findMany({ where: { memberId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, bodyEnc: true, createdAt: true, authorId: true, author: { select: { user: { select: { name: true } } } } } }),
      tx.trainingSession.findMany({
        where: { memberId, startsAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        orderBy: { startsAt: "asc" },
        take: 20,
        select: { id: true, startsAt: true, endsAt: true, status: true, focus: true, trainer: { select: { user: { select: { name: true } } } }, member: { select: { id: true, firstName: true, lastName: true } } },
      }),
      tx.checkIn.findFirst({ where: { memberId, result: "ALLOWED" }, orderBy: { checkedInAt: "desc" }, select: { checkedInAt: true } }),
    ]);
    if (photos?.length) {
      await recordAudit(tx, ctx, { action: "progress_photo.view", entityType: "Member", entityId: memberId, changes: { photos: photos.length } }, meta);
    }
    const current = profile.memberships.find((m) => m.state === "active") ?? profile.memberships.find((m) => m.state === "frozen");
    return {
      member: {
        id: profile.member.id,
        name: `${profile.member.firstName} ${profile.member.lastName}`,
        memberNumber: formatMemberNumber(profile.member.memberNumber),
        phone: profile.member.phone,
        joinedAt: profile.member.joinedAt.toISOString(),
      },
      status: profile.status,
      membership: current ? { planName: current.planName, endDate: current.endDate } : null,
      visits: { last30Days: profile.visits.last30Days, total: profile.visits.total, lastVisit: lastVisit?.checkedInAt.toISOString() ?? null },
      plans: plans.map(planRow),
      completions: completions.map((x) => ({ id: x.id, completedAt: x.completedAt.toISOString(), plan: x.day.plan.title, day: x.day.title, note: completionNote(ctx.gym.id, x.id, x.noteEnc) })),
      progress,
      photos,
      notes: notes.flatMap((n) => {
        const body = tryDecrypt(n.bodyEnc, noteCrypto(ctx.gym.id, n.id));
        return body === null ? [] : [{ id: n.id, body, author: n.author.user.name, mine: n.authorId === c.staffId, createdAt: n.createdAt.toISOString() }];
      }),
      sessions: sessions.map((s) => sessionItem(s, s.trainer.user.name)),
      isMyClient: mine,
    };
  });
}

export async function addTrainerNote(ctx: TenantContext, memberId: string, body: string, meta: RequestMeta) {
  const c = coach(ctx);
  assertWritable(ctx);
  return inTenant(ctx, async (tx) => {
    await assertCanCoach(tx, c, memberId);
    const id = createId();
    const row = await tx.trainerClientNote.create({
      data: { id, gymId: ctx.gym.id, memberId, authorId: c.staffId, bodyEnc: encryptField(body, noteCrypto(ctx.gym.id, id)) },
      select: { id: true, createdAt: true },
    });
    await recordAudit(tx, ctx, { action: "trainer_note.create", entityType: "Member", entityId: memberId, changes: { noteId: id } }, meta);
    return { id: row.id, body, author: ctx.user.name, mine: true, createdAt: row.createdAt.toISOString() };
  });
}

// ─────────────────────────────── Personal training sessions ───────────────────────────────

type SessionRow = { id: string; startsAt: Date; endsAt: Date; status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"; focus: string | null; member: { id: string; firstName: string; lastName: string } };

function sessionItem(s: SessionRow, trainer: string) {
  return { id: s.id, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), status: s.status, focus: s.focus, trainer, member: { id: s.member.id, name: fullName(s.member) } };
}

/** Booking and closing live in the PT module (alerts, manager booking); the trainer app uses them too. */
export function createTrainingSession(ctx: TenantContext, input: { memberId: string; startsAt: string; durationMinutes: number; focus: string | null; deliveryMode?: "IN_PERSON" | "ONLINE" }, meta: RequestMeta) {
  return bookSession(ctx, { memberId: input.memberId, startsAt: new Date(input.startsAt), durationMinutes: input.durationMinutes, focus: input.focus, deliveryMode: input.deliveryMode }, meta);
}

export function updateTrainingSession(ctx: TenantContext, id: string, status: "COMPLETED" | "CANCELLED" | "NO_SHOW", meta: RequestMeta) {
  return closeSession(ctx, id, status, meta);
}

/** The member's upcoming PT sessions (RLS: their own only). */
export function memberTrainingSessions(ctx: MemberContext) {
  return inMember(ctx, async (tx) => {
    const rows = await tx.trainingSession.findMany({
      where: { memberId: ctx.memberId, startsAt: { gte: new Date(Date.now() - 2 * 3_600_000) }, status: { in: ["SCHEDULED", "COMPLETED"] } },
      orderBy: { startsAt: "asc" },
      take: 20,
      select: { id: true, startsAt: true, endsAt: true, status: true, focus: true, trainerId: true, member: { select: { id: true, firstName: true, lastName: true } } },
    });
    const names = await staffNamesForMember(tx, rows.map((r) => r.trainerId));
    return { sessions: rows.map((r) => sessionItem(r, names.get(r.trainerId) ?? "Your trainer")) };
  });
}
