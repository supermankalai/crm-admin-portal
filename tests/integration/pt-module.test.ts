import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, fromDateString, localDate, localDateTime } from "@/domain/dates";
import { pushText } from "@/domain/notifications";
import { decryptJson, encryptJson } from "@/server/crypto";
import { appDb } from "@/server/db/client";
import { withMember, withTenant } from "@/server/db/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { removeStaff } from "@/server/services/staff";
import { assignTrainer, endAssignment, updateGoal } from "@/server/services/pt/assignments";
import { listPtClients, ptClient } from "@/server/services/pt/clients";
import { ptOverview } from "@/server/services/pt/overview";
import { bookSession, closeSession, listSessions } from "@/server/services/pt/sessions";
import { resolveTenant } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { createTwoGyms, type World } from "../support/fixtures";
import { asApp, disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/** The PT module: assignments with goals and history, notifications to both people, sessions, results. */

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const TZ = "Asia/Kolkata";
const today = () => localDate(new Date(), TZ);
/** A gym-local time n days from today. */
const on = (days: number, hhmm: string) => localDateTime(addDays(today(), days), hhmm, TZ);

let w: World;
let ownerA: TenantContext;
let deskA: TenantContext;
let trainer1: TenantContext;
let trainer2: TenantContext;
let ownerB: TenantContext;
const ids = { trainer1: "", trainer2: "", trainer1User: "", trainer2User: "", memberUser: "", member2: "" };

async function inbox(userId: string) {
  return getOwnerDb().notification.findMany({ where: { recipientUserId: userId }, orderBy: { createdAt: "asc" }, select: { type: true, title: true, body: true, entityId: true } });
}

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const db = getOwnerDb();
  const test = await db.platformPlan.update({ where: { code: "TEST" }, data: { maxMembers: 100, maxStaff: 20 } });
  for (const g of [w.gymA, w.gymB]) {
    await db.gym.update({ where: { id: g.id }, data: { status: "ACTIVE", timezone: TZ } });
    await db.gymSubscription.create({ data: { gymId: g.id, planId: test.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  }
  const staff = async (email: string) => {
    const u = await db.user.create({ data: { email, name: email.split("@")[0], passwordHash: "$argon2id$x" } });
    const s = await db.staffMember.create({ data: { gymId: w.gymA.id, userId: u.id, role: "TRAINER" } });
    return { userId: u.id, staffId: s.id, u };
  };
  const t1 = await staff("tara@pt.test");
  const t2 = await staff("tom@pt.test");
  ids.trainer1 = t1.staffId;
  ids.trainer2 = t2.staffId;
  ids.trainer1User = t1.userId;
  ids.trainer2User = t2.userId;

  // Alice (memberA) uses the member app; Mo has no app account.
  const memberUser = await db.user.create({ data: { email: "alice.app@pt.test", name: "Alice", passwordHash: "$argon2id$x" } });
  ids.memberUser = memberUser.id;
  await db.memberAccount.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, userId: memberUser.id } });
  ids.member2 = (await db.member.create({ data: { gymId: w.gymA.id, memberNumber: 2, firstName: "Mo", lastName: "Noapp", checkInCode: "MONO000002" } })).id;

  // Alice's measurements: 80 kg twelve weeks ago, down to 77 kg now.
  for (const [i, kg] of [80, 79, 78, 77].entries()) {
    const id = createId();
    await db.progressEntry.create({
      data: { id, gymId: w.gymA.id, memberId: w.memberA.id, recordedOn: fromDateString(addDays(today(), -84 + i * 28)), measurementsEnc: encryptJson({ weightKg: kg }, { gymId: w.gymA.id, model: "ProgressEntry", field: "measurements", recordId: id }) },
    });
  }

  const u = (x: { id: string; name: string; email: string | null }) => ({ id: x.id, name: x.name, email: x.email ?? "", isSuperAdmin: false });
  ownerA = (await resolveTenant(u(w.users.ownerA), "gym-a"))!;
  deskA = (await resolveTenant(u(w.users.deskA), "gym-a"))!;
  trainer1 = (await resolveTenant(u(t1.u), "gym-a"))!;
  trainer2 = (await resolveTenant(u(t2.u), "gym-a"))!;
  ownerB = (await resolveTenant(u(w.users.ownerB), "gym-b"))!;
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

let assignmentId = "";

describe("assigning a trainer", () => {
  it("records the goal with encrypted targets and notifies the member and the trainer", async () => {
    const r = await assignTrainer(ownerA, { memberId: w.memberA.id, trainerId: ids.trainer1, goal: "WEIGHT_LOSS", targets: { targetWeightKg: 74, targetDate: addDays(today(), 60), note: "Bad knee" } }, meta);
    assignmentId = r.assignmentId;

    const row = await getOwnerDb().trainerClient.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(row).toMatchObject({ goal: "WEIGHT_LOSS", assignedById: w.staff.ownerA.id });
    expect(row.targetsEnc).not.toContain("Bad knee");
    expect(decryptJson(row.targetsEnc!, { gymId: w.gymA.id, model: "TrainerClient", field: "targets", recordId: assignmentId })).toMatchObject({ targetWeightKg: 74, note: "Bad knee" });

    expect(await inbox(ids.memberUser)).toEqual([expect.objectContaining({ type: "PT_ASSIGNED", title: "You have a personal trainer", body: expect.stringContaining("tara is now your personal trainer") })]);
    expect(await inbox(ids.trainer1User)).toEqual([expect.objectContaining({ type: "PT_ASSIGNED", title: "New PT client", body: expect.stringContaining("Alice Anand is now your client") })]);
  });

  it("keeps lock-screen text generic", () => {
    for (const recipient of ["member", "staff"] as const) {
      const t = pushText("PT_ASSIGNED", recipient, "Gym A");
      expect(t.title).toBe("Gym A");
      expect(t.body).not.toMatch(/Alice|tara|weight/i);
    }
  });

  it("refuses a duplicate, a non-trainer, and a member from another gym", async () => {
    await expect(assignTrainer(ownerA, { memberId: w.memberA.id, trainerId: ids.trainer1, goal: null, targets: null }, meta)).rejects.toBeInstanceOf(ConflictError);
    await expect(assignTrainer(ownerA, { memberId: w.memberA.id, trainerId: w.staff.deskA.id, goal: null, targets: null }, meta)).rejects.toBeInstanceOf(ValidationError);
    await expect(assignTrainer(ownerA, { memberId: w.memberB.id, trainerId: ids.trainer1, goal: null, targets: null }, meta)).rejects.toBeInstanceOf(NotFoundError);
    await expect(assignTrainer(ownerB, { memberId: w.memberA.id, trainerId: ids.trainer1, goal: null, targets: null }, meta)).rejects.toBeInstanceOf(ValidationError);
  });

  it("is for owners and managers only — in the app and in the database", async () => {
    await expect(assignTrainer(trainer1, { memberId: ids.member2, trainerId: ids.trainer1, goal: null, targets: null }, meta)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assignTrainer(deskA, { memberId: ids.member2, trainerId: ids.trainer1, goal: null, targets: null }, meta)).rejects.toBeInstanceOf(ForbiddenError);
    // Straight to the database as a trainer: RLS refuses.
    await expect(
      withTenant({ userId: ids.trainer1User, gymId: w.gymA.id }, (tx) => tx.trainerClient.create({ data: { gymId: w.gymA.id, trainerId: ids.trainer1, memberId: ids.member2 }, select: { id: true } }))
    ).rejects.toThrow(/row-level security/);
    await expect(
      withTenant({ userId: ids.trainer1User, gymId: w.gymA.id }, (tx) => tx.trainerClient.deleteMany({ where: { id: assignmentId } }))
    ).resolves.toEqual({ count: 0 });
  });

  it("lets the member read who their trainer is", async () => {
    const rows = await withMember({ userId: ids.memberUser, gymId: w.gymA.id, memberId: w.memberA.id }, (tx) => tx.trainerClient.findMany({ select: { trainerId: true } }));
    expect(rows).toEqual([{ trainerId: ids.trainer1 }]);
  });

  it("changes the goal (managers only)", async () => {
    await updateGoal(ownerA, { assignmentId, goal: "WEIGHT_LOSS", targets: { targetWeightKg: 74, targetBodyFatPct: 22 } }, meta);
    await expect(updateGoal(trainer1, { assignmentId, goal: "STRENGTH", targets: null }, meta)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("results", () => {
  it("shows the trainer their client's progress toward the target", async () => {
    const d = await ptClient(trainer1, w.memberA.id);
    expect(d.assignments).toHaveLength(1);
    expect(d.assignments[0].progress).toEqual([expect.objectContaining({ metric: "weightKg", start: 77, current: 77, target: 74 })]);
    expect(d.viewer.isTrainer).toBe(true);
    expect(d.photoCount).toBe(0);
  });

  it("measures progress from where the client was when training began", async () => {
    // Backdate the start: the baseline becomes the 80 kg entry, 3 of 6 kg lost so far.
    await getOwnerDb().trainerClient.update({ where: { id: assignmentId }, data: { startedOn: fromDateString(addDays(today(), -84)) } });
    const d = await ptClient(ownerA, w.memberA.id);
    expect(d.assignments[0].progress[0]).toMatchObject({ start: 80, current: 77, target: 74, percent: 50, remaining: 3, reached: false });
    // Managers see results but not the photos (or how many there are).
    expect(d.photoCount).toBeNull();
  });

  it("hides clients from other trainers and other gyms", async () => {
    await expect(ptClient(trainer2, w.memberA.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ptClient(ownerB, w.memberA.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ptClient(deskA, w.memberA.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listPtClients(trainer2, {})).clients).toEqual([]);
    expect((await listPtClients(trainer1, {})).clients.map((c) => c.name)).toEqual(["Alice Anand"]);
    expect((await listPtClients(ownerA, { goal: "STRENGTH" })).clients).toEqual([]);
  });

  it("summarises the gym for managers and a trainer's own clients for trainers", async () => {
    const o = await ptOverview(ownerA);
    expect(o.totals.clients).toBe(1);
    expect(o.trainers.map((t) => [t.name, t.clients])).toEqual([
      ["tara", 1],
      ["tom", 0],
    ]);
    expect((await ptOverview(trainer2)).totals.clients).toBe(0);
  });
});

describe("PT sessions", () => {
  let sessionId = "";

  it("a manager books for a trainer: the member and the trainer are both told", async () => {
    const r = await bookSession(ownerA, { trainerId: ids.trainer1, memberId: w.memberA.id, startsAt: on(2, "07:00"), durationMinutes: 60, focus: "Legs" }, meta);
    sessionId = r.id;
    expect(await getOwnerDb().trainingSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ trainerId: ids.trainer1, bookedById: w.staff.ownerA.id });
    expect((await inbox(ids.memberUser)).at(-1)).toMatchObject({ type: "PT_SESSION_BOOKED", body: expect.stringContaining("with tara") });
    expect((await inbox(ids.trainer1User)).at(-1)).toMatchObject({ type: "PT_SESSION_BOOKED", body: expect.stringContaining("with Alice Anand") });
  });

  it("a trainer booking their own session doesn't notify themselves", async () => {
    const before = (await inbox(ids.trainer1User)).length;
    await bookSession(trainer1, { memberId: w.memberA.id, startsAt: on(3, "07:00"), durationMinutes: 45, focus: null }, meta);
    expect(await inbox(ids.trainer1User)).toHaveLength(before);
  });

  it("refuses clashes, other trainers' clients and trainers booking for someone else", async () => {
    await expect(bookSession(ownerA, { trainerId: ids.trainer1, memberId: w.memberA.id, startsAt: on(2, "07:30"), durationMinutes: 60, focus: null }, meta)).rejects.toBeInstanceOf(ConflictError);
    await expect(bookSession(trainer2, { memberId: w.memberA.id, startsAt: on(4, "07:00"), durationMinutes: 60, focus: null }, meta)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(bookSession(ownerA, { trainerId: ids.trainer2, memberId: w.memberA.id, startsAt: on(4, "07:00"), durationMinutes: 60, focus: null }, meta)).rejects.toThrow(/isn't a client of tom/);
    await expect(bookSession(trainer1, { trainerId: ids.trainer2, memberId: w.memberA.id, startsAt: on(4, "07:00"), durationMinutes: 60, focus: null }, meta)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lists sessions: trainers only their own", async () => {
    const from = today();
    expect((await listSessions(ownerA, { from })).sessions).toHaveLength(2);
    expect((await listSessions(trainer1, { from })).sessions).toHaveLength(2);
    expect((await listSessions(trainer2, { from, trainerId: ids.trainer1 })).sessions).toHaveLength(0);
  });

  it("cancelling tells the member, and the trainer when someone else cancelled", async () => {
    await closeSession(ownerA, sessionId, "CANCELLED", meta);
    expect((await inbox(ids.memberUser)).at(-1)).toMatchObject({ type: "PT_SESSION_CANCELLED", entityId: sessionId });
    expect((await inbox(ids.trainer1User)).at(-1)).toMatchObject({ type: "PT_SESSION_CANCELLED", entityId: sessionId });
    await expect(closeSession(ownerA, sessionId, "CANCELLED", meta)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("ending an assignment", () => {
  it("keeps the history, cancels future sessions, removes the trainer's access and tells both", async () => {
    const r = await endAssignment(ownerA, { assignmentId, reason: "Goal reached" }, meta);
    expect(r.cancelledSessions).toBe(1);

    const db = getOwnerDb();
    expect(await db.trainerClient.count({ where: { id: assignmentId } })).toBe(0);
    const h = await db.ptAssignmentHistory.findFirstOrThrow({ where: { memberId: w.memberA.id } });
    expect(h).toMatchObject({ trainerId: ids.trainer1, goal: "WEIGHT_LOSS", endReason: "Goal reached", endedById: w.staff.ownerA.id });
    expect(decryptJson(h.targetsEnc!, { gymId: w.gymA.id, model: "PtAssignmentHistory", field: "targets", recordId: h.id })).toMatchObject({ targetWeightKg: 74, targetBodyFatPct: 22 });
    expect(await db.trainingSession.count({ where: { trainerId: ids.trainer1, status: "SCHEDULED" } })).toBe(0);

    expect((await inbox(ids.memberUser)).at(-1)).toMatchObject({ type: "PT_ENDED", body: expect.stringContaining("tara is no longer your personal trainer") });
    expect((await inbox(ids.trainer1User)).at(-1)).toMatchObject({ type: "PT_ENDED" });

    // The trainer can't see the client any more — in the service or in the database.
    await expect(ptClient(trainer1, w.memberA.id)).rejects.toBeInstanceOf(NotFoundError);
    const visible = await asApp({ userId: ids.trainer1User, gymId: w.gymA.id }, (tx) => tx.progressEntry.count({ where: { memberId: w.memberA.id } }));
    expect(visible).toBe(0);
    // The history appears on the client page and the overview.
    expect((await ptClient(ownerA, w.memberA.id)).history).toEqual([expect.objectContaining({ trainerName: "tara", endReason: "Goal reached" })]);
  });

  it("history is append-only for the app", async () => {
    await expect(withTenant({ userId: w.users.ownerA.id, gymId: w.gymA.id }, (tx) => tx.ptAssignmentHistory.updateMany({ data: { endReason: "edited" } }))).rejects.toThrow(/permission denied/);
    await expect(withTenant({ userId: w.users.ownerA.id, gymId: w.gymA.id }, (tx) => tx.ptAssignmentHistory.deleteMany({}))).rejects.toThrow(/permission denied/);
    // A trainer sees only their own past assignments.
    const seen = await withTenant({ userId: ids.trainer2User, gymId: w.gymA.id }, (tx) => tx.ptAssignmentHistory.count());
    expect(seen).toBe(0);
  });

  it("a trainer leaving the gym ends all their assignments (and members are told)", async () => {
    await assignTrainer(ownerA, { memberId: w.memberA.id, trainerId: ids.trainer2, goal: null, targets: null }, meta);
    await assignTrainer(ownerA, { memberId: ids.member2, trainerId: ids.trainer2, goal: "STRENGTH", targets: null }, meta);
    const trainerInbox = (await inbox(ids.trainer2User)).length;
    await removeStaff(ownerA, ids.trainer2, meta);

    const db = getOwnerDb();
    expect(await db.trainerClient.count({ where: { trainerId: ids.trainer2 } })).toBe(0);
    expect(await db.ptAssignmentHistory.count({ where: { trainerId: ids.trainer2, endReason: "Trainer left the gym" } })).toBe(2);
    expect((await inbox(ids.memberUser)).at(-1)).toMatchObject({ type: "PT_ENDED" });
    // The person who left isn't sent alerts about it.
    expect(await inbox(ids.trainer2User)).toHaveLength(trainerInbox);
  });

  it("can't end another gym's assignment", async () => {
    const a = await assignTrainer(ownerA, { memberId: ids.member2, trainerId: ids.trainer1, goal: null, targets: null }, meta);
    await expect(endAssignment(ownerB, { assignmentId: a.assignmentId, reason: null }, meta)).rejects.toBeInstanceOf(NotFoundError);
    expect(await getOwnerDb().trainerClient.count({ where: { id: a.assignmentId } })).toBe(1);
  });
});
