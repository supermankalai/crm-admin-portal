import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, fromDateString, localDate } from "@/domain/dates";
import { appDb } from "@/server/db/client";
import { ForbiddenError, NotFoundError, PlanLimitError, ValidationError } from "@/server/errors";
import { getDashboard } from "@/server/services/dashboard";
import { archiveMembershipPlan, createMembershipPlan, listMembershipPlans } from "@/server/services/membership-plans";
import { addMemberNote, createMember, readGymFile, setMemberPhoto, softDeleteMember, updateMember } from "@/server/services/members/commands";
import { listMembers } from "@/server/services/members/list";
import { cancelMembership, freezeMembership, unfreezeMembership } from "@/server/services/members/memberships";
import { getMemberProfile } from "@/server/services/members/profile";
import { resolveTenant } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { createTwoGyms, type World } from "../support/fixtures";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const TZ = "Asia/Kolkata";
const today = () => localDate(new Date(), TZ);
const member = { firstName: "Ravi", lastName: "Kumar", email: "ravi@example.com", phone: "+91 98765 43210", address: "12 MG Road, Bengaluru", dateOfBirth: "1990-05-17", healthNotes: "Asthma", emergencyContact: { name: "Lata Kumar", phone: "+91 99000 11111", relation: "Mother" } };

let w: World;
let ownerA: TenantContext;
let deskA: TenantContext;
let trainerA: TenantContext;
let ownerB: TenantContext;
let planId: string;

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const owner = getOwnerDb();
  const test = await owner.platformPlan.findFirstOrThrow({ where: { code: "TEST" } });
  for (const g of [w.gymA, w.gymB]) {
    await owner.gym.update({ where: { id: g.id }, data: { status: "ACTIVE", timezone: TZ } });
    await owner.gymSubscription.create({ data: { gymId: g.id, planId: test.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
    await owner.gymCounter.createMany({ data: [{ gymId: g.id, key: "member", value: 1 }, { gymId: g.id, key: "invoice", value: 0 }] });
  }
  const trainerUser = await owner.user.create({ data: { email: "trainer.a@test.example", name: "Trainer A", passwordHash: "$argon2id$x" } });
  await owner.staffMember.create({ data: { gymId: w.gymA.id, userId: trainerUser.id, role: "TRAINER" } });

  const u = (x: { id: string; name: string; email: string }) => ({ ...x, isSuperAdmin: false });
  ownerA = (await resolveTenant(u(w.users.ownerA), "gym-a"))!;
  deskA = (await resolveTenant(u(w.users.deskA), "gym-a"))!;
  trainerA = (await resolveTenant(u(trainerUser), "gym-a"))!;
  ownerB = (await resolveTenant(u(w.users.ownerB), "gym-b"))!;
  const plan = await createMembershipPlan(ownerA, { name: "Quarterly", description: null, type: "QUARTERLY", price: 675_000, durationDays: 90, classCredits: null, allowFreeze: true, maxFreezeDays: 14, cancellationNoticeDays: 7, cancellationFee: 50_000, isActive: true }, meta);
  planId = plan!.id;
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("creating members", () => {
  it("encrypts personal data, indexes the phone and numbers members per gym", async () => {
    const { id, memberNumber } = await createMember(deskA, memberSchemaInput(member), meta);
    expect(memberNumber).toBe(2); // fixture already has member 1

    const row = await getOwnerDb().member.findUniqueOrThrow({ where: { id } });
    for (const field of ["phoneEnc", "addressEnc", "dateOfBirthEnc", "emergencyContactEnc", "healthNotesEnc"] as const) {
      expect(row[field]).toMatch(/^v1\./);
    }
    const raw = JSON.stringify(row);
    for (const secret of ["98765", "MG Road", "1990-05-17", "Lata", "Asthma"]) expect(raw).not.toContain(secret);
    expect(row.phoneBlindIndex).toMatch(/^1\.[0-9a-f]{64}$/);
    expect(await getOwnerDb().auditLog.count({ where: { entityId: id, action: "member.create" } })).toBe(1);
  });

  it("the profile shows the decrypted values to staff of the same gym", async () => {
    const [found] = (await listMembers(ownerA, { q: "ravi@example.com" })).rows;
    const profile = await getMemberProfile(ownerA, found.id);
    expect(profile.member).toMatchObject({ phone: "+91 98765 43210", address: "12 MG Road, Bengaluru", dateOfBirth: "1990-05-17", healthNotes: "Asthma" });
    expect(profile.member.emergencyContact).toEqual({ name: "Lata Kumar", phone: "+91 99000 11111", relation: "Mother" });
  });

  it("rejects a duplicate email in the same gym, but allows it in another gym", async () => {
    await expect(createMember(ownerA, memberSchemaInput({ ...member, email: "RAVI@example.com" }), meta)).rejects.toMatchObject({ fieldErrors: { email: [expect.stringMatching(/already exists/)] } });
    await expect(createMember(ownerB, memberSchemaInput(member), meta)).resolves.toMatchObject({ memberNumber: 2 });
  });

  it("refuses new members beyond the plan limit with an upgrade message", async () => {
    const owner = getOwnerDb();
    const tiny = await owner.platformPlan.create({ data: { code: "ONE", name: "One", priceMonthlyMinor: 0, maxMembers: 2, maxStaff: 5, maxLocations: 1, featureReports: false, featureCsvExport: false, featureClassBookings: false } });
    await owner.gymSubscription.update({ where: { gymId: w.gymB.id }, data: { planId: tiny.id } });
    const ctx = (await resolveTenant({ ...w.users.ownerB, isSuperAdmin: false }, "gym-b"))!;
    await expect(createMember(ctx, memberSchemaInput({ ...member, email: "third@example.com" }), meta)).rejects.toThrow(PlanLimitError);
    await owner.gymSubscription.update({ where: { gymId: w.gymB.id }, data: { planId: (await owner.platformPlan.findFirstOrThrow({ where: { code: "TEST" } })).id } });
  });

  it("trainers cannot create members", async () => {
    await expect(createMember(trainerA, memberSchemaInput({ ...member, email: "t@example.com" }), meta)).rejects.toThrow(ForbiddenError);
  });
});

describe("searching and filtering", () => {
  it("finds members by exact phone through the blind index, in any format", async () => {
    for (const q of ["9876543210", "+91 98765-43210", "098765 43210"]) {
      expect((await listMembers(ownerA, { q })).rows.map((r) => r.name)).toEqual(["Ravi Kumar"]);
    }
    expect((await listMembers(ownerA, { q: "98765" })).total).toBe(0); // partial phone: no match (by design)
  });

  it("the same phone in another gym is a different blind index (no cross-tenant correlation)", async () => {
    const [a] = await getOwnerDb().member.findMany({ where: { gymId: w.gymA.id, email: "ravi@example.com" } });
    const [b] = await getOwnerDb().member.findMany({ where: { gymId: w.gymB.id, email: "ravi@example.com" } });
    expect(a.phoneBlindIndex).not.toBe(b.phoneBlindIndex);
  });

  it("finds by member number, email and name tokens", async () => {
    expect((await listMembers(ownerA, { q: "M-000002" })).rows[0]?.name).toBe("Ravi Kumar");
    expect((await listMembers(ownerA, { q: "ravi@" })).total).toBe(1);
    expect((await listMembers(ownerA, { q: "kumar ravi" })).total).toBe(1);
  });

  it("filters by membership status", async () => {
    const [ravi] = (await listMembers(ownerA, { q: "ravi@example.com" })).rows;
    expect((await listMembers(ownerA, { status: "none" })).rows.map((r) => r.id)).toContain(ravi.id);
    await giveMembership(ravi.id, addDays(today(), -10), addDays(today(), 80));
    expect((await listMembers(ownerA, { status: "active" })).rows.map((r) => r.id)).toContain(ravi.id);
    expect((await listMembers(ownerA, { status: "none" })).rows.map((r) => r.id)).not.toContain(ravi.id);
  });

  it("never returns another gym's members", async () => {
    const names = (await listMembers(ownerB, {})).rows.map((r) => r.name);
    expect(names).not.toContain("Alice Anand");
    await expect(getMemberProfile(ownerB, w.memberA.id)).rejects.toThrow(NotFoundError);
  });

  it("trainers see only their assigned clients", async () => {
    expect((await listMembers(trainerA, {})).total).toBe(0);
    await getOwnerDb().trainerClient.create({ data: { gymId: w.gymA.id, trainerId: trainerA.staffId!, memberId: w.memberA.id } });
    expect((await listMembers(trainerA, {})).rows.map((r) => r.name)).toEqual(["Alice Anand"]);
    const [ravi] = (await listMembers(ownerA, { q: "ravi@example.com" })).rows;
    await expect(getMemberProfile(trainerA, ravi.id)).rejects.toThrow(NotFoundError);
  });
});

describe("updating, notes, photos and deleting", () => {
  it("front desk may change contact details only — and the change is re-encrypted and re-indexed", async () => {
    const [ravi] = (await listMembers(ownerA, { q: "ravi@example.com" })).rows;
    await expect(updateMember(deskA, ravi.id, { firstName: "Hacked" }, meta)).rejects.toThrow(/only change contact details/);
    const { changed } = await updateMember(deskA, ravi.id, { phone: "+91 91234 56789" }, meta);
    expect(changed).toEqual(["phone"]);
    expect((await listMembers(ownerA, { q: "9123456789" })).rows[0]?.id).toBe(ravi.id);
    expect((await listMembers(ownerA, { q: "9876543210" })).total).toBe(0);
    const audit = await getOwnerDb().auditLog.findFirstOrThrow({ where: { entityId: ravi.id, action: "member.update" } });
    expect(audit.changes).toEqual({ fields: ["phone"] }); // names only, never values
  });

  it("notes are encrypted; trainers may add them only for their own clients", async () => {
    const { id } = await addMemberNote(trainerA, w.memberA.id, "Knee pain on lunges", meta);
    const row = await getOwnerDb().memberNote.findUniqueOrThrow({ where: { id } });
    expect(row.bodyEnc).not.toContain("Knee");
    const notes = (await getMemberProfile(ownerA, w.memberA.id)).notes;
    expect(notes[0].body).toBe("Knee pain on lunges");
    // The fixture note holds a corrupt ciphertext: shown as a placeholder, not a crashed page.
    expect(notes.at(-1)?.body).toBe("[This note could not be decrypted]");
    const [ravi] = (await listMembers(ownerA, { q: "ravi@example.com" })).rows;
    await expect(addMemberNote(trainerA, ravi.id, "Not my client", meta)).rejects.toThrow(NotFoundError);
  });

  it("validates uploaded photos by their bytes and serves them only within the gym", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001", "hex");
    await expect(setMemberPhoto(ownerA, w.memberA.id, Buffer.from("<script>alert(1)</script>"), meta)).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(setMemberPhoto(ownerA, w.memberA.id, Buffer.alloc(3 * 1024 * 1024, 0xff), meta)).rejects.toThrow(/2 MB/);
    await setMemberPhoto(ownerA, w.memberA.id, png, meta);
    const { photoFileId } = await getOwnerDb().member.findUniqueOrThrow({ where: { id: w.memberA.id } });
    expect((await readGymFile(ownerA, photoFileId!))?.mimeType).toBe("image/png");
    expect(await readGymFile(ownerB, photoFileId!)).toBeNull();
    const asset = await getOwnerDb().fileAsset.findUniqueOrThrow({ where: { id: photoFileId! } });
    expect(asset.storageKey.startsWith(`${w.gymA.id}/member-photo/`)).toBe(true);
  });

  it("soft delete hides the member but keeps history, and frees the email", async () => {
    const created = await createMember(ownerA, memberSchemaInput({ ...member, email: "gone@example.com", phone: null }), meta);
    await expect(softDeleteMember(deskA, created.id, meta)).rejects.toThrow(ForbiddenError);
    await softDeleteMember(ownerA, created.id, meta);
    expect((await listMembers(ownerA, { q: "gone@" })).total).toBe(0);
    expect(await getOwnerDb().member.count({ where: { id: created.id } })).toBe(1);
    await expect(createMember(ownerA, memberSchemaInput({ ...member, email: "gone@example.com", phone: null }), meta)).resolves.toBeTruthy();
  });
});

describe("membership rules in the database", () => {
  it("freeze, unfreeze and cancel follow the plan rules and are audited", async () => {
    const [ravi] = (await listMembers(ownerA, { q: "ravi@example.com" })).rows;
    const membership = await getOwnerDb().membership.findFirstOrThrow({ where: { memberId: ravi.id } });
    const end0 = membership.endDate.toISOString().slice(0, 10);

    const frozen = await freezeMembership(ownerA, membership.id, 10, meta);
    expect(frozen.newEndDate).toBe(addDays(end0, 10));
    expect((await listMembers(ownerA, { status: "frozen" })).rows.map((r) => r.id)).toContain(ravi.id);
    await expect(freezeMembership(ownerA, membership.id, 2, meta)).rejects.toThrow(/already frozen/);

    await unfreezeMembership(ownerA, membership.id, meta);
    const afterUnfreeze = await getOwnerDb().membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(afterUnfreeze.endDate.toISOString().slice(0, 10)).toBe(end0); // all 10 days returned (unfrozen on day 1)
    await expect(freezeMembership(ownerA, membership.id, 15, meta)).rejects.toThrow(/Only 14 freeze days left/);

    await expect(cancelMembership(deskA, membership.id, "Moving away", meta)).rejects.toThrow(ForbiddenError);
    const cancelled = await cancelMembership(ownerA, membership.id, "Moving away", meta);
    expect(cancelled).toMatchObject({ endsImmediately: false, effectiveEnd: addDays(today(), 7), feeMinor: 50_000 });
    const actions = (await getOwnerDb().auditLog.findMany({ where: { entityId: membership.id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["membership.freeze", "membership.unfreeze", "membership.cancel"]));
  });

  it("another gym cannot change this gym's memberships", async () => {
    const membership = await getOwnerDb().membership.findFirstOrThrow({ where: { gymId: w.gymA.id } });
    await expect(freezeMembership(ownerB, membership.id, 1, meta)).rejects.toThrow(NotFoundError);
  });
});

describe("membership plans", () => {
  it("plan names are unique per gym (case-insensitive), not across gyms", async () => {
    const input = { name: "quarterly", description: null, type: "QUARTERLY" as const, price: 1, durationDays: 90, classCredits: null, allowFreeze: false, maxFreezeDays: 0, cancellationNoticeDays: 0, cancellationFee: 0, isActive: true };
    await expect(createMembershipPlan(ownerA, input, meta)).rejects.toThrow(ValidationError);
    await expect(createMembershipPlan(ownerB, input, meta)).resolves.toBeTruthy();
    await expect(createMembershipPlan(deskA, input, meta)).rejects.toThrow(ForbiddenError);
  });

  it("archiving keeps existing memberships and frees the name", async () => {
    await archiveMembershipPlan(ownerA, planId, meta);
    expect((await listMembershipPlans(ownerA)).map((p) => p.id)).not.toContain(planId);
    expect(await getOwnerDb().membership.count({ where: { planId } })).toBeGreaterThan(0);
  });
});

describe("dashboard figures", () => {
  it("match the underlying data for this gym only", async () => {
    const owner = getOwnerDb();
    const [ravi] = (await listMembers(ownerA, { q: "ravi@example.com" })).rows;
    await owner.payment.create({ data: { gymId: w.gymA.id, memberId: ravi.id, amountMinor: 100_000, currency: "INR", method: "CASH", receivedAt: new Date(), recordedById: ownerA.staffId! } });
    const refundOf = await owner.payment.create({ data: { gymId: w.gymA.id, memberId: ravi.id, amountMinor: 30_000, currency: "INR", method: "CARD", receivedAt: new Date(), recordedById: ownerA.staffId! } });
    await owner.refund.create({ data: { gymId: w.gymA.id, paymentId: refundOf.id, amountMinor: 10_000, reason: "test", refundedAt: new Date(), recordedById: ownerA.staffId! } });
    await owner.payment.create({ data: { gymId: w.gymB.id, memberId: (await owner.member.findFirstOrThrow({ where: { gymId: w.gymB.id } })).id, amountMinor: 999_999, currency: "INR", method: "CASH", receivedAt: new Date(), recordedById: ownerB.staffId! } });

    const d = await getDashboard(ownerA);
    expect(d.revenue?.today).toBe(120_000); // 1000 + 300 − 100 (gym B's payment excluded)
    expect(d.newThisMonth).toBeGreaterThanOrEqual(2);
    expect(d.activeMembers).toBe(1);
    expect(d.growth).toHaveLength(6);

    const desk = await getDashboard(deskA);
    expect(desk.revenue).toBeNull(); // front desk does not see financials
  });
});

// ── helpers ──
function memberSchemaInput(m: { firstName: string; lastName: string; email: string | null; phone: string | null; address: string | null; dateOfBirth: string | null; healthNotes: string | null; emergencyContact: { name: string | null; phone: string | null; relation: string | null } }) {
  return m;
}

async function giveMembership(memberId: string, start: string, end: string) {
  await getOwnerDb().membership.create({
    data: { id: createId(), gymId: w.gymA.id, memberId, planId, startDate: fromDateString(start), endDate: fromDateString(end), priceMinor: 675_000 },
  });
}
