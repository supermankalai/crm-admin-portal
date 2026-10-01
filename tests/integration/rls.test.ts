import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTwoGyms, type World } from "../support/fixtures";
import { asApp, disconnectAll, getAppDb, getOwnerDb, truncateAll } from "../support/test-db";

/**
 * Database-level tenant isolation, exercised through the restricted gym_app role exactly as
 * the running app connects. These tests use direct queries with a *Gym A* context and prove
 * Gym B's rows can be neither read nor written.
 */

let w: World;

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
});

afterAll(async () => {
  await disconnectAll();
});

const ctxA = () => ({ userId: w.users.ownerA.id, gymId: w.gymA.id });

describe("app database role", () => {
  it("is not a superuser and cannot bypass RLS", async () => {
    const [role] = await getAppDb().$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean }[]>`
      SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
  });

  it("cannot create objects in the schema", async () => {
    await expect(getAppDb().$executeRawUnsafe(`CREATE TABLE "gym-admin-portal".evil (id int)`)).rejects.toThrow(/permission denied/i);
  });

  it("cannot disable RLS on a table", async () => {
    await expect(getAppDb().$executeRawUnsafe(`ALTER TABLE "gym-admin-portal"."Member" DISABLE ROW LEVEL SECURITY`)).rejects.toThrow(/must be owner/i);
  });
});

describe("missing tenant context fails closed", () => {
  it("returns no tenant rows and no users without any context", async () => {
    const counts = await asApp({}, async (tx) => ({
      members: await tx.member.count(),
      staff: await tx.staffMember.count(),
      notes: await tx.memberNote.count(),
      audit: await tx.auditLog.count(),
      gyms: await tx.gym.count(),
      users: await tx.user.count(),
    }));
    expect(counts).toEqual({ members: 0, staff: 0, notes: 0, audit: 0, gyms: 0, users: 0 });
  });

  it("returns no rows when only the user is known (no gym selected)", async () => {
    expect(await asApp({ userId: w.users.ownerA.id }, (tx) => tx.member.count())).toBe(0);
  });

  it("rejects inserts without a gym context", async () => {
    await expect(
      asApp({ userId: w.users.ownerA.id }, (tx) =>
        tx.member.createMany({ data: [{ gymId: w.gymA.id, memberNumber: 99, firstName: "X", lastName: "Y", checkInCode: "NOCTX00001" }] })
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("platform tables stay readable where intended (public pricing)", async () => {
    expect(await asApp({}, (tx) => tx.platformPlan.count())).toBe(1);
  });
});

describe("Gym A context cannot read Gym B", () => {
  it("sees only its own members, notes and staff", async () => {
    const result = await asApp(ctxA(), async (tx) => ({
      members: (await tx.member.findMany({ select: { gymId: true } })).map((m) => m.gymId),
      notes: (await tx.memberNote.findMany({ select: { gymId: true } })).map((m) => m.gymId),
      staff: (await tx.staffMember.findMany({ select: { gymId: true } })).map((m) => m.gymId),
    }));
    expect(new Set([...result.members, ...result.notes, ...result.staff])).toEqual(new Set([w.gymA.id]));
  });

  it("cannot fetch a Gym B row even by its exact id", async () => {
    expect(await asApp(ctxA(), (tx) => tx.member.findUnique({ where: { id: w.memberB.id } }))).toBeNull();
    expect(await asApp(ctxA(), (tx) => tx.auditLog.count({ where: { gymId: w.gymB.id } }))).toBe(0);
  });

  it("cannot read Gym B by spoofing the gym id in the session context", async () => {
    // Owner A claims to be in Gym B: membership check in the policy rejects it.
    const spoofed = { userId: w.users.ownerA.id, gymId: w.gymB.id };
    expect(await asApp(spoofed, (tx) => tx.member.count())).toBe(0);
    expect(await asApp(spoofed, (tx) => tx.gym.findUnique({ where: { id: w.gymB.id } }))).toBeNull();
  });

  it("only sees users who share the current gym", async () => {
    const emails = await asApp(ctxA(), (tx) => tx.user.findMany({ select: { email: true } }));
    expect(emails.map((u) => u.email).sort()).toEqual(["desk.a@test.example", "owner.a@test.example", "removed.a@test.example"]);
  });
});

describe("Gym A context cannot write Gym B", () => {
  it("cannot insert a row into Gym B", async () => {
    await expect(
      asApp(ctxA(), (tx) =>
        tx.member.createMany({ data: [{ gymId: w.gymB.id, memberNumber: 50, firstName: "Mallory", lastName: "M", checkInCode: "EVIL000001" }] })
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("cannot update Gym B rows (zero rows affected)", async () => {
    const result = await asApp(ctxA(), (tx) => tx.member.updateMany({ where: { id: w.memberB.id }, data: { firstName: "Hacked" } }));
    expect(result.count).toBe(0);
    const unchanged = await getOwnerDb().member.findUniqueOrThrow({ where: { id: w.memberB.id } });
    expect(unchanged.firstName).toBe("Bob");
  });

  it("cannot move its own row into Gym B", async () => {
    await expect(
      asApp(ctxA(), (tx) => tx.memberNote.updateMany({ where: { id: w.noteA.id }, data: { gymId: w.gymB.id } }))
    ).rejects.toThrow();
  });

  it("cannot delete Gym B rows (zero rows affected)", async () => {
    const result = await asApp(ctxA(), (tx) => tx.memberNote.deleteMany({ where: { id: w.noteB.id } }));
    expect(result.count).toBe(0);
    expect(await getOwnerDb().memberNote.count({ where: { id: w.noteB.id } })).toBe(1);
  });

  it("cannot hard-delete members at all (soft delete only)", async () => {
    await expect(asApp(ctxA(), (tx) => tx.member.deleteMany({ where: { id: w.memberA.id } }))).rejects.toThrow(/permission denied/i);
  });
});

describe("structural isolation (composite foreign keys)", () => {
  it("a Gym A membership cannot reference a Gym B member, even for the owner role", async () => {
    const owner = getOwnerDb();
    const plan = await owner.membershipPlan.create({
      data: { gymId: w.gymA.id, name: "Monthly", type: "MONTHLY", priceMinor: 100_000, durationDays: 30 },
    });
    await expect(
      owner.membership.create({
        data: { gymId: w.gymA.id, memberId: w.memberB.id, planId: plan.id, startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31"), priceMinor: 100_000 },
      })
    ).rejects.toThrow(/foreign key/i);
  });
});

describe("staff status and roles", () => {
  it("a user removed from Gym A immediately loses access", async () => {
    const ctx = { userId: w.users.removedA.id, gymId: w.gymA.id };
    expect(await asApp(ctx, (tx) => tx.member.count())).toBe(0);
  });

  it("a user can list their own gyms before choosing one", async () => {
    const rows = await asApp({ userId: w.users.deskA.id }, (tx) =>
      tx.staffMember.findMany({ where: { userId: w.users.deskA.id }, select: { gym: { select: { slug: true } } } })
    );
    expect(rows.map((r) => r.gym.slug)).toEqual(["gym-a"]);
  });
});

describe("audit logs are append-only", () => {
  it("the app role can append but not update or delete", async () => {
    await asApp(ctxA(), (tx) =>
      tx.auditLog.createMany({ data: [{ gymId: w.gymA.id, actorUserId: w.users.ownerA.id, actorType: "USER", action: "test.append", entityType: "Member" }] })
    );
    await expect(asApp(ctxA(), (tx) => tx.auditLog.updateMany({ data: { action: "tampered" } }))).rejects.toThrow(/permission denied/i);
    await expect(asApp(ctxA(), (tx) => tx.auditLog.deleteMany({}))).rejects.toThrow(/permission denied/i);
  });

  it("even the owner role cannot UPDATE or DELETE audit rows (trigger)", async () => {
    await getOwnerDb().platformAuditLog.create({ data: { action: "auth.login" } });
    await expect(getOwnerDb().auditLog.updateMany({ data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(getOwnerDb().platformAuditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it("platform audit entries can be written anonymously but not read back", async () => {
    await asApp({}, (tx) => tx.platformAuditLog.createMany({ data: [{ action: "auth.login_failed" }] }));
    expect(await asApp({}, (tx) => tx.platformAuditLog.count())).toBe(0);
  });
});

describe("sensitive platform tables", () => {
  it("password reset tokens are not readable by the app role at all", async () => {
    await expect(asApp({ userId: w.users.ownerA.id }, (tx) => tx.passwordResetToken.count())).rejects.toThrow(/permission denied/i);
  });

  it("rate-limit buckets are only reachable through the rate_limit_hit function", async () => {
    await expect(asApp({}, (tx) => tx.rateLimitBucket.count())).rejects.toThrow(/permission denied/i);
    const key = `test:${createId()}`;
    const results = [];
    for (let i = 0; i < 4; i++) {
      const [row] = await asApp({}, (tx) => tx.$queryRaw<{ allowed: boolean }[]>`SELECT * FROM rate_limit_hit(${key}, 3, 60)`);
      results.push(row.allowed);
    }
    expect(results).toEqual([true, true, true, false]);

    // rate_limit_reset returns void: callers must use $executeRaw (regression: login success path).
    await asApp({}, (tx) => tx.$executeRaw`SELECT rate_limit_reset(${key})`);
    const [after] = await asApp({}, (tx) => tx.$queryRaw<{ allowed: boolean }[]>`SELECT * FROM rate_limit_hit(${key}, 3, 60)`);
    expect(after.allowed).toBe(true);
  });

  it("login lookup works before authentication and returns only auth fields", async () => {
    const rows = await asApp({}, (tx) => tx.$queryRaw<Record<string, unknown>[]>`SELECT * FROM auth_lookup_user(${"OWNER.A@test.example "})`);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "isSuperAdmin", "name", "passwordHash", "sessionVersion"]);
  });

  it("a user cannot grant themselves super admin", async () => {
    await expect(
      asApp({ userId: w.users.ownerA.id }, (tx) => tx.user.updateMany({ where: { id: w.users.ownerA.id }, data: { isSuperAdmin: true } }))
    ).rejects.toThrow(/database owner/);
  });
});

describe("super admin access", () => {
  it("the platform-admin flag alone grants nothing to a non-super-admin", async () => {
    expect(await asApp({ userId: w.users.ownerA.id, platformAdmin: true }, (tx) => tx.gym.count())).toBe(1); // only their own gym
  });

  it("a super admin sees platform data but never tenant rows without support access", async () => {
    const ctx = { userId: w.users.superAdmin.id, platformAdmin: true };
    expect(await asApp(ctx, (tx) => tx.gym.count())).toBe(2);
    expect(await asApp(ctx, (tx) => tx.member.count())).toBe(0);
    expect(await asApp({ ...ctx, gymId: w.gymB.id }, (tx) => tx.member.count())).toBe(0);
  });

  it("an active support session gives read-only access to exactly one gym", async () => {
    const owner = getOwnerDb();
    const session = await owner.supportAccessSession.create({
      data: { gymId: w.gymB.id, superAdminId: w.users.superAdmin.id, reason: "Ticket #123", expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    const ctx = { userId: w.users.superAdmin.id, gymId: w.gymB.id, supportSessionId: session.id };

    expect(await asApp(ctx, (tx) => tx.member.count())).toBe(1);
    expect(await asApp({ ...ctx, gymId: w.gymA.id }, (tx) => tx.member.count())).toBe(0);
    const updated = await asApp(ctx, (tx) => tx.member.updateMany({ data: { firstName: "Support" } }));
    expect(updated.count).toBe(0);
  });

  it("an expired support session gives no access", async () => {
    const session = await getOwnerDb().supportAccessSession.create({
      data: { gymId: w.gymB.id, superAdminId: w.users.superAdmin.id, reason: "Old", startedAt: new Date(Date.now() - 7_200_000), expiresAt: new Date(Date.now() - 60_000) },
    });
    const ctx = { userId: w.users.superAdmin.id, gymId: w.gymB.id, supportSessionId: session.id };
    expect(await asApp(ctx, (tx) => tx.member.count())).toBe(0);
  });
});

describe("per-gym uniqueness", () => {
  it("the same member email may exist in two gyms but not twice in one gym", async () => {
    const owner = getOwnerDb();
    await owner.member.create({ data: { gymId: w.gymB.id, memberNumber: 2, firstName: "A", lastName: "B", email: "ALICE@example.com", checkInCode: "DUPB000001" } });
    await expect(
      owner.member.create({ data: { gymId: w.gymA.id, memberNumber: 2, firstName: "A", lastName: "B", email: "Alice@Example.com", checkInCode: "DUPA000001" } })
    ).rejects.toThrow(/unique/i);
  });

  it("soft-deleting a member frees their email within the gym", async () => {
    const owner = getOwnerDb();
    await owner.member.update({ where: { id: w.memberA.id }, data: { deletedAt: new Date() } });
    await expect(
      owner.member.create({ data: { gymId: w.gymA.id, memberNumber: 3, firstName: "New", lastName: "Alice", email: "alice@example.com", checkInCode: "DUPA000002" } })
    ).resolves.toBeTruthy();
  });
});
