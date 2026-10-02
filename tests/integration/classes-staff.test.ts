import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, fromDateString, localDate } from "@/domain/dates";
import { appDb } from "@/server/db/client";
import { FeatureNotInPlanError, ForbiddenError, NotFoundError, PlanLimitError, ValidationError } from "@/server/errors";
import { bookMember, cancelBooking, markAttendance } from "@/server/services/classes/bookings";
import { cancelSession, createSessions, getSession, listWeek, updateSession } from "@/server/services/classes/sessions";
import { acceptInvitationAsUser, acceptInvitationWithNewAccount, lookupInvitation } from "@/server/services/invitations";
import { addShift, changeStaffRole, inviteStaff, removeStaff, revokeInvitation } from "@/server/services/staff";
import { resolveTenant } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { createTwoGyms, type World } from "../support/fixtures";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const TZ = "Asia/Kolkata";
const tomorrow = () => addDays(localDate(new Date(), TZ), 1);
const u = (x: { id: string; name: string; email: string }) => ({ ...x, isSuperAdmin: false });

let w: World;
let ownerA: TenantContext;
let deskA: TenantContext;
let trainerA: TenantContext;
let ownerB: TenantContext;
let trainerStaffId: string;
let classTypeId: string;
let roomId: string;
let roomBId: string;
let monthlyPlanId: string;
let packPlanId: string;
let locationId: string;

async function newMember(n: number, plan: "monthly" | "pack" | "none", credits = 3) {
  const owner = getOwnerDb();
  const member = await owner.member.create({ data: { gymId: w.gymA.id, memberNumber: 1000 + n, firstName: `M${n}`, lastName: "Class", checkInCode: `CLS${String(n).padStart(7, "0")}` } });
  if (plan !== "none") {
    const today = localDate(new Date(), TZ);
    await owner.membership.create({
      data: {
        id: createId(),
        gymId: w.gymA.id,
        memberId: member.id,
        planId: plan === "pack" ? packPlanId : monthlyPlanId,
        startDate: fromDateString(addDays(today, -5)),
        endDate: fromDateString(addDays(today, 25)),
        priceMinor: 1,
        classCreditsRemaining: plan === "pack" ? credits : null,
      },
    });
  }
  return member.id;
}

async function scheduleOne(capacity: number, daysAhead = 1, hour = "18:00") {
  await createSessions(ownerA, { classTypeId, trainerId: trainerStaffId, roomId, date: addDays(localDate(new Date(), TZ), daysAhead), startTime: hour, durationMinutes: 45, capacity, repeatWeeks: 1 }, meta);
  return getOwnerDb().classSession.findFirstOrThrow({ where: { gymId: w.gymA.id }, orderBy: { createdAt: "desc" } });
}

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const owner = getOwnerDb();
  const plan = await owner.platformPlan.update({ where: { code: "TEST" }, data: { maxMembers: 100, maxStaff: 6 } });
  for (const g of [w.gymA, w.gymB]) {
    await owner.gym.update({ where: { id: g.id }, data: { status: "ACTIVE", timezone: TZ } });
    await owner.gymSubscription.create({ data: { gymId: g.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  }
  const trainerUser = await owner.user.create({ data: { email: "coach.a@test.example", name: "Coach A", passwordHash: "$argon2id$x" } });
  trainerStaffId = (await owner.staffMember.create({ data: { gymId: w.gymA.id, userId: trainerUser.id, role: "TRAINER" } })).id;
  locationId = (await owner.location.create({ data: { gymId: w.gymA.id, name: "Main" } })).id;
  const locationB = await owner.location.create({ data: { gymId: w.gymB.id, name: "Main" } });
  roomId = (await owner.room.create({ data: { gymId: w.gymA.id, locationId, name: "Studio", capacity: 30 } })).id;
  roomBId = (await owner.room.create({ data: { gymId: w.gymB.id, locationId: locationB.id, name: "Studio", capacity: 30 } })).id;
  classTypeId = (await owner.classType.create({ data: { gymId: w.gymA.id, name: "HIIT", color: "#ef4444", durationMinutes: 45, defaultCapacity: 10 } })).id;
  monthlyPlanId = (await owner.membershipPlan.create({ data: { gymId: w.gymA.id, name: "Monthly", type: "MONTHLY", priceMinor: 1, durationDays: 30 } })).id;
  packPlanId = (await owner.membershipPlan.create({ data: { gymId: w.gymA.id, name: "Pack", type: "CLASS_PACK", priceMinor: 1, durationDays: 60, classCredits: 10 } })).id;

  ownerA = (await resolveTenant(u(w.users.ownerA), "gym-a"))!;
  deskA = (await resolveTenant(u(w.users.deskA), "gym-a"))!;
  trainerA = (await resolveTenant(u(trainerUser), "gym-a"))!;
  ownerB = (await resolveTenant(u(w.users.ownerB), "gym-b"))!;
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("scheduling", () => {
  it("schedules weekly repeats and refuses trainer or room double-booking", async () => {
    const r = await createSessions(ownerA, { classTypeId, trainerId: trainerStaffId, roomId, date: tomorrow(), startTime: "07:00", durationMinutes: 45, capacity: 10, repeatWeeks: 4 }, meta);
    expect(r.created).toBe(4);
    await expect(createSessions(ownerA, { classTypeId, trainerId: trainerStaffId, roomId, date: tomorrow(), startTime: "07:30", durationMinutes: 45, capacity: 10, repeatWeeks: 1 }, meta)).rejects.toThrow(/already teaching/);
    await expect(createSessions(ownerA, { classTypeId, trainerId: ownerA.staffId!, roomId, date: tomorrow(), startTime: "07:15", durationMinutes: 30, capacity: 10, repeatWeeks: 1 }, meta)).rejects.toThrow(/Studio is already booked/);
  });

  it("refuses capacity above the room, past times, and other gyms' rooms", async () => {
    await expect(createSessions(ownerA, { classTypeId, trainerId: trainerStaffId, roomId, date: tomorrow(), startTime: "21:00", durationMinutes: 30, capacity: 31, repeatWeeks: 1 }, meta)).rejects.toThrow(/holds at most 30/);
    await expect(createSessions(ownerA, { classTypeId, trainerId: trainerStaffId, roomId, date: addDays(tomorrow(), -3), startTime: "06:00", durationMinutes: 30, capacity: 5, repeatWeeks: 1 }, meta)).rejects.toThrow(/in the future/);
    await expect(createSessions(ownerA, { classTypeId, trainerId: trainerStaffId, roomId: roomBId, date: tomorrow(), startTime: "22:00", durationMinutes: 30, capacity: 5, repeatWeeks: 1 }, meta)).rejects.toThrow(/Choose a room/);
    await expect(createSessions(deskA, { classTypeId, trainerId: trainerStaffId, roomId, date: tomorrow(), startTime: "22:00", durationMinutes: 30, capacity: 5, repeatWeeks: 1 }, meta)).rejects.toThrow(ForbiddenError);
  });

  it("trainers see only their own classes; other gyms see none", async () => {
    await createSessions(ownerA, { classTypeId, trainerId: ownerA.staffId!, roomId, date: tomorrow(), startTime: "12:00", durationMinutes: 30, capacity: 5, repeatWeeks: 1 }, meta);
    const monday = addDays(tomorrow(), -((new Date(`${tomorrow()}T00:00:00Z`).getUTCDay() + 6) % 7));
    const all = await listWeek(ownerA, monday);
    const mine = await listWeek(trainerA, monday);
    expect(all.length).toBeGreaterThan(mine.length);
    expect(mine.every((s) => s.trainerId === trainerStaffId)).toBe(true);
    expect(await listWeek(ownerB, monday)).toHaveLength(0);
  });
});

describe("bookings: capacity, waitlist and concurrency", () => {
  it("never overbooks: 20 simultaneous bookings for 5 spots give 5 booked and 15 waitlisted in order", async () => {
    const session = await scheduleOne(5, 2, "09:00");
    const members = await Promise.all(Array.from({ length: 20 }, (_, i) => newMember(i, "monthly")));
    const results = await Promise.all(members.map((memberId) => bookMember(deskA, { sessionId: session.id, memberId }, meta)));
    expect(results.filter((r) => r.status === "BOOKED")).toHaveLength(5);
    const waitlisted = results.filter((r) => r.status === "WAITLISTED").map((r) => r.waitlistPosition).sort((a, b) => a! - b!);
    expect(waitlisted).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(await getOwnerDb().booking.count({ where: { sessionId: session.id, status: "BOOKED" } })).toBe(5);
  });

  it("refuses double booking and members without an active membership", async () => {
    const session = await scheduleOne(5, 3, "09:00");
    const memberId = await newMember(100, "monthly");
    await bookMember(deskA, { sessionId: session.id, memberId }, meta);
    await expect(bookMember(deskA, { sessionId: session.id, memberId }, meta)).rejects.toThrow(/Already booked/);
    const noMembership = await newMember(101, "none");
    await expect(bookMember(deskA, { sessionId: session.id, memberId: noMembership }, meta)).rejects.toThrow(/needs an active membership/);
  });

  it("cancelling a booked spot promotes the first person on the waitlist and renumbers it", async () => {
    const session = await scheduleOne(1, 4, "09:00");
    const [a, b, c] = await Promise.all([newMember(200, "monthly"), newMember(201, "monthly"), newMember(202, "monthly")]);
    const first = await bookMember(deskA, { sessionId: session.id, memberId: a }, meta);
    await bookMember(deskA, { sessionId: session.id, memberId: b }, meta);
    await bookMember(deskA, { sessionId: session.id, memberId: c }, meta);
    const r = await cancelBooking(deskA, first.bookingId, meta);
    expect(r.promoted).toBe(1);
    const bookings = await getOwnerDb().booking.findMany({ where: { sessionId: session.id }, orderBy: { memberId: "asc" } });
    const byMember = Object.fromEntries(bookings.map((x) => [x.memberId, x]));
    expect(byMember[b]).toMatchObject({ status: "BOOKED", waitlistPosition: null });
    expect(byMember[c]).toMatchObject({ status: "WAITLISTED", waitlistPosition: 1 });
  });

  it("class packs spend a credit on a confirmed spot, give it back on cancellation, and on promotion spend again", async () => {
    const session = await scheduleOne(1, 5, "09:00");
    const packMember = await newMember(300, "pack", 2);
    const credits = async () => (await getOwnerDb().membership.findFirstOrThrow({ where: { memberId: packMember } })).classCreditsRemaining;
    const b = await bookMember(deskA, { sessionId: session.id, memberId: packMember }, meta);
    expect(await credits()).toBe(1);
    await cancelBooking(deskA, b.bookingId, meta);
    expect(await credits()).toBe(2);

    const filler = await newMember(301, "monthly");
    const fill = await bookMember(deskA, { sessionId: session.id, memberId: filler }, meta);
    const wait = await bookMember(deskA, { sessionId: session.id, memberId: packMember }, meta);
    expect(wait.status).toBe("WAITLISTED");
    expect(await credits()).toBe(2); // no credit while waiting
    await cancelBooking(deskA, fill.bookingId, meta);
    expect(await credits()).toBe(1); // promoted → credit spent
  });

  it("an empty class pack can't book", async () => {
    const session = await scheduleOne(5, 6, "09:00");
    const empty = await newMember(400, "pack", 0);
    await expect(bookMember(deskA, { sessionId: session.id, memberId: empty }, meta)).rejects.toThrow(/no classes left/);
  });

  it("raising capacity fills spots from the waitlist; lowering below bookings is refused", async () => {
    const session = await scheduleOne(1, 7, "09:00");
    const [a, b, c] = await Promise.all([newMember(500, "monthly"), newMember(501, "monthly"), newMember(502, "monthly")]);
    for (const memberId of [a, b, c]) await bookMember(deskA, { sessionId: session.id, memberId }, meta);
    const r = await updateSession(ownerA, { sessionId: session.id, trainerId: trainerStaffId, roomId, capacity: 3 }, meta);
    expect(r.promoted).toBe(2);
    await expect(updateSession(ownerA, { sessionId: session.id, trainerId: trainerStaffId, roomId, capacity: 2 }, meta)).rejects.toThrow(/can't be lower/);
  });

  it("cancelling a class cancels every booking and returns credits", async () => {
    const session = await scheduleOne(5, 8, "09:00");
    const pack = await newMember(600, "pack", 3);
    await bookMember(deskA, { sessionId: session.id, memberId: pack }, meta);
    await expect(cancelSession(deskA, session.id, "Trainer ill", meta)).rejects.toThrow(ForbiddenError);
    const r = await cancelSession(trainerA, session.id, "Trainer ill", meta); // trainers may cancel their own class
    expect(r.bookingsCancelled).toBe(1);
    expect((await getOwnerDb().membership.findFirstOrThrow({ where: { memberId: pack } })).classCreditsRemaining).toBe(3);
    await expect(bookMember(deskA, { sessionId: session.id, memberId: pack }, meta)).rejects.toThrow(/cancelled/);
  });

  it("attendance can only be marked around class time, by the class trainer or a manager", async () => {
    const session = await scheduleOne(5, 9, "09:00");
    const memberId = await newMember(700, "monthly");
    const b = await bookMember(deskA, { sessionId: session.id, memberId }, meta);
    await expect(markAttendance(trainerA, b.bookingId, true, meta)).rejects.toThrow(/Attendance can be marked/);
    const owner = getOwnerDb();
    await owner.classSession.update({ where: { id: session.id }, data: { startsAt: new Date(Date.now() - 10 * 60_000), endsAt: new Date(Date.now() + 35 * 60_000) } });
    await expect(markAttendance(deskA, b.bookingId, true, meta)).rejects.toThrow(ForbiddenError);
    expect(await markAttendance(trainerA, b.bookingId, true, meta)).toEqual({ status: "ATTENDED" });
  });

  it("bookings are blocked when the plan has no class bookings", async () => {
    const session = await scheduleOne(5, 10, "09:00");
    const memberId = await newMember(800, "monthly");
    const noFeature = { ...deskA, plan: { ...deskA.plan!, features: { ...deskA.plan!.features, classBookings: false } } };
    await expect(bookMember(noFeature, { sessionId: session.id, memberId }, meta)).rejects.toThrow(FeatureNotInPlanError);
  });

  it("another gym can neither see nor book this gym's classes", async () => {
    const session = await scheduleOne(5, 11, "09:00");
    await expect(getSession(ownerB, session.id)).rejects.toThrow(NotFoundError);
    await expect(bookMember(ownerB, { sessionId: session.id, memberId: w.memberB.id }, meta)).rejects.toThrow(NotFoundError);
  });
});

describe("staff invitations", () => {
  it("creates a hashed single-use invitation and accepts it with a new account", async () => {
    const { link } = await inviteStaff(ownerA, { email: "newcoach@test.example", role: "TRAINER" }, meta);
    const token = link.split("/invite/")[1];
    const stored = await getOwnerDb().staffInvitation.findFirstOrThrow({ where: { email: "newcoach@test.example" } });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await lookupInvitation(token)).toMatchObject({ gymName: "Gym A", role: "TRAINER", state: "valid", hasAccount: false });

    const r = await acceptInvitationWithNewAccount(token, "New Coach", "Strong-Pass1");
    expect(r?.gymSlug).toBe("gym-a");
    const user = await getOwnerDb().user.findUniqueOrThrow({ where: { email: "newcoach@test.example" } });
    expect(await resolveTenant(u(user), "gym-a")).toMatchObject({ role: "TRAINER" });
    expect(await lookupInvitation(token)).toMatchObject({ state: "used" });
    await expect(acceptInvitationWithNewAccount(token, "Again", "Strong-Pass1")).rejects.toThrow(/already been used/);
  });

  it("an existing account must be signed in as the invited email", async () => {
    const { link } = await inviteStaff(ownerB, { email: "desk.a@test.example", role: "FRONT_DESK" }, meta);
    const token = link.split("/invite/")[1];
    expect(await lookupInvitation(token)).toMatchObject({ hasAccount: true });
    await expect(acceptInvitationWithNewAccount(token, "Imposter", "Strong-Pass1")).rejects.toThrow(/Sign in with the invited email/);
    await expect(acceptInvitationAsUser(w.users.ownerA.id, token)).rejects.toThrow(/different email/);
    expect(await acceptInvitationAsUser(w.users.deskA.id, token)).toEqual({ gymSlug: "gym-b" });
    // The same person now works at both gyms with different roles.
    expect((await resolveTenant(u(w.users.deskA), "gym-b"))?.role).toBe("FRONT_DESK");
    expect((await resolveTenant(u(w.users.deskA), "gym-a"))?.role).toBe("FRONT_DESK");
  });

  it("revoked and expired invitations stop working; managers can't invite managers", async () => {
    const { link, invitationId } = await inviteStaff(ownerA, { email: "revoked@test.example", role: "TRAINER" }, meta);
    await revokeInvitation(ownerA, invitationId, meta);
    await expect(acceptInvitationWithNewAccount(link.split("/invite/")[1], "R", "Strong-Pass1")).rejects.toThrow(/withdrawn/);

    const second = await inviteStaff(ownerA, { email: "late@test.example", role: "TRAINER" }, meta);
    await getOwnerDb().staffInvitation.update({ where: { id: second.invitationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptInvitationWithNewAccount(second.link.split("/invite/")[1], "L", "Strong-Pass1")).rejects.toThrow(/expired/);

    const managerUser = await getOwnerDb().user.create({ data: { email: "mgr.a@test.example", name: "Mgr", passwordHash: "$argon2id$x" } });
    await getOwnerDb().staffMember.create({ data: { gymId: w.gymA.id, userId: managerUser.id, role: "MANAGER" } });
    const mgr = (await resolveTenant(u(managerUser), "gym-a"))!;
    await expect(inviteStaff(mgr, { email: "x@test.example", role: "MANAGER" }, meta)).rejects.toThrow(/front desk staff and trainers only/);
  });

  it("pending invitations count toward the plan's staff limit", async () => {
    // maxStaff = 6: gym A has owner, desk, coach, new coach, manager = 5 active.
    await inviteStaff(ownerA, { email: "sixth@test.example", role: "TRAINER" }, meta);
    await expect(inviteStaff(ownerA, { email: "seventh@test.example", role: "TRAINER" }, meta)).rejects.toThrow(PlanLimitError);
  });
});

describe("roles and removal", () => {
  it("the last owner can't be demoted or removed", async () => {
    await expect(changeStaffRole(ownerA, ownerA.staffId!, "MANAGER", meta)).rejects.toThrow(/at least one owner/);
    await expect(removeStaff(ownerA, ownerA.staffId!, meta)).rejects.toThrow(/last owner/);
    await expect(changeStaffRole(deskA, trainerStaffId, "MANAGER", meta)).rejects.toThrow(ForbiddenError);
  });

  it("removing a staff member ends their access to this gym immediately", async () => {
    const coach = await getOwnerDb().user.findUniqueOrThrow({ where: { email: "newcoach@test.example" } });
    const staff = await getOwnerDb().staffMember.findFirstOrThrow({ where: { userId: coach.id, gymId: w.gymA.id } });
    await removeStaff(ownerA, staff.id, meta);
    expect(await resolveTenant(u(coach), "gym-a")).toBeNull();
    expect(await getOwnerDb().auditLog.count({ where: { action: "staff.remove", entityId: staff.id } })).toBe(1);
  });

  it("shifts can't overlap for the same person", async () => {
    await addShift(ownerA, { staffId: trainerStaffId, locationId, date: tomorrow(), start: "06:00", end: "10:00" }, meta);
    await expect(addShift(ownerA, { staffId: trainerStaffId, locationId, date: tomorrow(), start: "09:00", end: "12:00" }, meta)).rejects.toThrow(ValidationError);
  });
});
