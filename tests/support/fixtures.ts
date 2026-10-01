import { createId } from "@paralleldrive/cuid2";
import { getOwnerDb } from "./test-db";

/**
 * Minimal two-tenant world created with the OWNER client (bypasses RLS):
 * gym A and gym B, each with an owner, a front-desk user, a member and a note,
 * plus a super admin and a user removed from gym A.
 */
export async function createTwoGyms() {
  const db = getOwnerDb();
  const mk = () => createId();

  await db.platformPlan.create({
    data: { id: mk(), code: "TEST", name: "Test", priceMonthlyMinor: 0, maxMembers: 10, maxStaff: 5, maxLocations: 1, featureReports: true, featureCsvExport: true, featureClassBookings: true },
  });

  const users = {
    ownerA: { id: mk(), email: "owner.a@test.example", name: "Owner A" },
    deskA: { id: mk(), email: "desk.a@test.example", name: "Desk A" },
    removedA: { id: mk(), email: "removed.a@test.example", name: "Removed A" },
    ownerB: { id: mk(), email: "owner.b@test.example", name: "Owner B" },
    superAdmin: { id: mk(), email: "root@test.example", name: "Super Admin" },
  };
  await db.user.createMany({
    data: Object.values(users).map((u) => ({ ...u, passwordHash: "$argon2id$placeholder", isSuperAdmin: u === users.superAdmin })),
  });

  const gymA = { id: mk(), slug: "gym-a" };
  const gymB = { id: mk(), slug: "gym-b" };
  await db.gym.createMany({ data: [{ ...gymA, name: "Gym A" }, { ...gymB, name: "Gym B" }] });

  const staff = {
    ownerA: { id: mk(), gymId: gymA.id, userId: users.ownerA.id, role: "OWNER" as const },
    deskA: { id: mk(), gymId: gymA.id, userId: users.deskA.id, role: "FRONT_DESK" as const },
    removedA: { id: mk(), gymId: gymA.id, userId: users.removedA.id, role: "MANAGER" as const, status: "REMOVED" as const },
    ownerB: { id: mk(), gymId: gymB.id, userId: users.ownerB.id, role: "OWNER" as const },
  };
  await db.staffMember.createMany({ data: Object.values(staff) });

  const memberA = { id: mk(), gymId: gymA.id, memberNumber: 1, firstName: "Alice", lastName: "Anand", email: "alice@example.com", checkInCode: "AAAA111111" };
  const memberB = { id: mk(), gymId: gymB.id, memberNumber: 1, firstName: "Bob", lastName: "Bose", email: "bob@example.com", checkInCode: "BBBB222222" };
  await db.member.createMany({ data: [memberA, memberB] });

  const noteA = { id: mk(), gymId: gymA.id, memberId: memberA.id, authorId: staff.ownerA.id, bodyEnc: "v1.x.y.z" };
  const noteB = { id: mk(), gymId: gymB.id, memberId: memberB.id, authorId: staff.ownerB.id, bodyEnc: "v1.x.y.z" };
  await db.memberNote.createMany({ data: [noteA, noteB] });

  await db.auditLog.create({ data: { gymId: gymB.id, actorType: "SYSTEM", action: "test.event", entityType: "Gym" } });

  return { gymA, gymB, users, staff, memberA, memberB, noteA, noteB };
}

export type World = Awaited<ReturnType<typeof createTwoGyms>>;
