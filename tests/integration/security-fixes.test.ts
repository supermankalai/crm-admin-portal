import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, fromDateString, localDate } from "@/domain/dates";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { appDb } from "@/server/db/client";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { changePassword, signOutEverywhere } from "@/server/services/account";
import { createSessions, updateSession } from "@/server/services/classes/sessions";
import { getDashboard } from "@/server/services/dashboard";
import { markAllNotificationsRead } from "@/server/services/notifications";
import { inviteStaff, revokeInvitation, updateStaffProfile } from "@/server/services/staff";
import { resolveTenant } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { createTwoGyms, type World } from "../support/fixtures";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/** Regression tests for the Phase 8 security review findings. */

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const TZ = "Asia/Kolkata";
const u = (x: { id: string; name: string; email: string }) => ({ ...x, isSuperAdmin: false });

let w: World;
let ownerA: TenantContext;
let managerA: TenantContext;
let trainerA: TenantContext;
let trainerStaffId: string;
let managerUserId: string;

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const db = getOwnerDb();
  const plan = await db.platformPlan.update({ where: { code: "TEST" }, data: { maxMembers: 50, maxStaff: 20 } });
  await db.gym.update({ where: { id: w.gymA.id }, data: { status: "ACTIVE", timezone: TZ } });
  await db.gymSubscription.create({ data: { gymId: w.gymA.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  const mgr = await db.user.create({ data: { email: "mgr.sec@test.example", name: "Manager", passwordHash: await hashPassword("Old-Password1") } });
  managerUserId = mgr.id;
  await db.staffMember.create({ data: { gymId: w.gymA.id, userId: mgr.id, role: "MANAGER" } });
  const coach = await db.user.create({ data: { email: "coach.sec@test.example", name: "Coach", passwordHash: "$argon2id$x" } });
  trainerStaffId = (await db.staffMember.create({ data: { gymId: w.gymA.id, userId: coach.id, role: "TRAINER" } })).id;
  ownerA = (await resolveTenant(u(w.users.ownerA), "gym-a"))!;
  managerA = (await resolveTenant(u(mgr), "gym-a"))!;
  trainerA = (await resolveTenant(u(coach), "gym-a"))!;
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("trainers only see their own clients on the dashboard (M3)", () => {
  it("expiring memberships are filtered to assigned clients", async () => {
    const db = getOwnerDb();
    const today = localDate(new Date(), TZ);
    const planId = (await db.membershipPlan.create({ data: { gymId: w.gymA.id, name: "Monthly", type: "MONTHLY", priceMinor: 1, durationDays: 30 } })).id;
    const client = await db.member.create({ data: { gymId: w.gymA.id, memberNumber: 50, firstName: "Client", lastName: "One", checkInCode: "SECC000001" } });
    const stranger = await db.member.create({ data: { gymId: w.gymA.id, memberNumber: 51, firstName: "Not", lastName: "Mine", checkInCode: "SECC000002" } });
    for (const m of [client, stranger]) {
      await db.membership.create({ data: { id: createId(), gymId: w.gymA.id, memberId: m.id, planId, startDate: fromDateString(addDays(today, -25)), endDate: fromDateString(addDays(today, 3)), priceMinor: 1 } });
    }
    await db.trainerClient.create({ data: { gymId: w.gymA.id, trainerId: trainerStaffId, memberId: client.id } });

    expect((await getDashboard(trainerA)).expiring.map((e) => e.name)).toEqual(["Client One"]);
    expect((await getDashboard(ownerA)).expiring.map((e) => e.name).sort()).toEqual(["Client One", "Not Mine"]);
  });
});

describe("managers can't act on owner-level staff (L3)", () => {
  const profile = (staffId: string) => ({ staffId, title: "Hacked", bio: null, specialties: [], phone: null, notes: "secret" });

  it("a manager edits trainers' profiles, but not the owner's", async () => {
    await updateStaffProfile(managerA, profile(trainerStaffId), meta);
    await expect(updateStaffProfile(managerA, profile(w.staff.ownerA.id), meta)).rejects.toThrow(ForbiddenError);
    expect((await getOwnerDb().staffMember.findUniqueOrThrow({ where: { id: w.staff.ownerA.id } })).title).toBeNull();
    await updateStaffProfile(ownerA, profile(w.staff.ownerA.id), meta); // owners may
  });

  it("a manager can't withdraw or replace an owner's invitation for a higher role", async () => {
    const { invitationId } = await inviteStaff(ownerA, { email: "future.manager@test.example", role: "MANAGER" }, meta);
    await expect(revokeInvitation(managerA, invitationId, meta)).rejects.toThrow(ForbiddenError);
    await expect(inviteStaff(managerA, { email: "future.manager@test.example", role: "TRAINER" }, meta)).rejects.toThrow(/already invited this person/);
    expect((await getOwnerDb().staffInvitation.findUniqueOrThrow({ where: { id: invitationId } })).revokedAt).toBeNull();
    await revokeInvitation(ownerA, invitationId, meta);

    const trainerInvite = await inviteStaff(ownerA, { email: "future.trainer@test.example", role: "TRAINER" }, meta);
    await revokeInvitation(managerA, trainerInvite.invitationId, meta); // within their own remit
  });
});

describe("a class can only be given to an active trainer (L4)", () => {
  it("refuses a removed staff member or front desk as the new trainer", async () => {
    const db = getOwnerDb();
    const location = await db.location.create({ data: { gymId: w.gymA.id, name: "Main" } });
    const room = await db.room.create({ data: { gymId: w.gymA.id, locationId: location.id, name: "Studio", capacity: 20 } });
    const type = await db.classType.create({ data: { gymId: w.gymA.id, name: "Spin", color: "#000000", durationMinutes: 45, defaultCapacity: 10 } });
    await createSessions(ownerA, { classTypeId: type.id, trainerId: trainerStaffId, roomId: room.id, date: addDays(localDate(new Date(), TZ), 2), startTime: "07:00", durationMinutes: 45, capacity: 10, repeatWeeks: 1 }, meta);
    const session = await db.classSession.findFirstOrThrow({ where: { gymId: w.gymA.id } });
    const edit = (trainerId: string) => updateSession(ownerA, { sessionId: session.id, trainerId, roomId: room.id, capacity: 10 }, meta);
    await expect(edit(w.staff.removedA.id)).rejects.toThrow(ValidationError);
    await expect(edit(w.staff.deskA.id)).rejects.toThrow(ValidationError);
    await edit(w.staff.ownerA.id);
  });
});

describe("notifications in read-only gyms", () => {
  it("staff can still mark alerts read when the subscription has lapsed; support access can't", async () => {
    const lapsed = { ...ownerA, access: { ...ownerA.access, writable: false, reason: "subscription_expired" as const } };
    await expect(markAllNotificationsRead(lapsed)).resolves.toEqual({ marked: 0 });
    await expect(markAllNotificationsRead({ ...ownerA, supportSessionId: "s" })).rejects.toThrow(ForbiddenError);
  });
});

describe("password change and sign-out everywhere (L2)", () => {
  const version = async () => (await getOwnerDb().user.findUniqueOrThrow({ where: { id: managerUserId } })).sessionVersion;

  it("a wrong current password changes nothing and is audited", async () => {
    const before = await version();
    await expect(changePassword(managerUserId, { currentPassword: "Wrong-Password1", newPassword: "New-Password22" }, meta)).rejects.toThrow(/current password is incorrect/);
    expect(await version()).toBe(before);
    expect(await getOwnerDb().platformAuditLog.count({ where: { actorUserId: managerUserId, action: "auth.password_change_failed" } })).toBe(1);
  });

  it("a password change stores the new hash and ends every session", async () => {
    const before = await version();
    await changePassword(managerUserId, { currentPassword: "Old-Password1", newPassword: "New-Password22" }, meta);
    const user = await getOwnerDb().user.findUniqueOrThrow({ where: { id: managerUserId } });
    expect(user.sessionVersion).toBe(before + 1);
    expect(await verifyPassword(user.passwordHash, "New-Password22")).toBe(true);
    expect(await verifyPassword(user.passwordHash, "Old-Password1")).toBe(false);
  });

  it("sign-out everywhere bumps the session version and is audited", async () => {
    const before = await version();
    await signOutEverywhere(managerUserId, meta);
    expect(await version()).toBe(before + 1);
    expect(await getOwnerDb().platformAuditLog.count({ where: { actorUserId: managerUserId, action: "auth.sessions_revoked" } })).toBe(1);
  });
});
