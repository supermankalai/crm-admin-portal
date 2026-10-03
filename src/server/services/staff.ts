import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { addDays, dayBounds, localDateTime } from "@/domain/dates";
import { overlaps } from "@/domain/classes";
import { assertCanChangeRole, assertCanInvite, assertCanRemove, INVITATION_DAYS, StaffRuleError } from "@/domain/staff";
import { assignableRoles, type GymRole } from "@/domain/permissions";
import { limitMessage } from "@/domain/plan-limits";
import { recordAudit } from "@/server/audit/tenant-audit";
import { encryptOptional, tryDecrypt } from "@/server/crypto";
import { getEmailProvider } from "@/server/email";
import { getEnv } from "@/server/env";
import { ForbiddenError, NotFoundError, PlanLimitError, ValidationError } from "@/server/errors";
import { planLimitsOf } from "@/server/plan/limits";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { todayFor } from "./members/shared";

function staffRule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof StaffRuleError) throw new ValidationError(error.message);
    throw error;
  }
}

const staffCrypto = (gymId: string, staffId: string) => ({
  enc: (field: "phone" | "notes", v: string | null) => encryptOptional(v, { gymId, model: "StaffMember", field, recordId: staffId }),
  dec: (field: "phone" | "notes", v: string | null) => tryDecrypt(v, { gymId, model: "StaffMember", field, recordId: staffId }),
});

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function listStaff(ctx: TenantContext) {
  assertCan(ctx, "staff.view");
  return inTenant(ctx, async (tx) => {
    const staff = await tx.staffMember.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
      select: {
        id: true,
        role: true,
        title: true,
        specialties: true,
        phoneEnc: true,
        createdAt: true,
        user: { select: { name: true, email: true, lastLoginAt: true } },
        _count: { select: { clients: true, classesTaught: { where: { status: "SCHEDULED", startsAt: { gte: new Date() } } } } },
      },
    });
    const invitations = await tx.staffInvitation.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true, invitedBy: { select: { user: { select: { name: true } } } } },
    });
    return {
      staff: staff.map((s) => ({ ...s, phone: staffCrypto(ctx.gym.id, s.id).dec("phone", s.phoneEnc), phoneEnc: undefined })),
      invitations,
    };
  });
}

export async function getStaffProfile(ctx: TenantContext, staffId: string) {
  const isSelf = staffId === ctx.staffId;
  if (!isSelf) assertCan(ctx, "staff.view");
  const tz = ctx.gym.timezone;
  const today = todayFor(ctx);
  return inTenant(ctx, async (tx) => {
    const s = await tx.staffMember.findFirst({ where: { id: staffId }, include: { user: { select: { name: true, email: true, lastLoginAt: true } } } });
    if (!s) throw new NotFoundError("Staff member not found.");
    const crypto = staffCrypto(ctx.gym.id, s.id);
    const clients = await tx.trainerClient.findMany({
      where: { trainerId: s.id, member: { deletedAt: null } },
      orderBy: { member: { lastName: "asc" } },
      select: { member: { select: { id: true, firstName: true, lastName: true, memberNumber: true } } },
    });
    const upcoming = await tx.classSession.findMany({
      where: { trainerId: s.id, status: "SCHEDULED", startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 10,
      select: { id: true, startsAt: true, endsAt: true, capacity: true, classType: { select: { name: true, color: true } }, room: { select: { name: true } } },
    });
    const shifts = await tx.staffShift.findMany({
      where: { staffId: s.id, startsAt: { gte: dayBounds(today, tz).start, lt: dayBounds(addDays(today, 27), tz).end } },
      orderBy: { startsAt: "asc" },
      select: { id: true, startsAt: true, endsAt: true, location: { select: { name: true } } },
    });
    const canSeeNotes = ctx.permissions.has("staff.invite");
    return {
      staff: {
        id: s.id,
        role: s.role,
        status: s.status,
        title: s.title,
        bio: s.bio,
        specialties: s.specialties,
        name: s.user.name,
        email: s.user.email,
        lastLoginAt: s.user.lastLoginAt,
        phone: crypto.dec("phone", s.phoneEnc),
        notes: canSeeNotes ? crypto.dec("notes", s.notesEnc) : null,
        createdAt: s.createdAt,
      },
      isSelf,
      canSeeNotes,
      clients: clients.map((c) => c.member),
      upcoming,
      shifts,
    };
  });
}

/**
 * Profile fields: staff edit their own; owners edit anyone; managers edit the roles they may
 * assign (front desk, trainers) — never an owner's or another manager's. Staff notes likewise.
 */
export async function updateStaffProfile(
  ctx: TenantContext,
  input: { staffId: string; title: string | null; bio: string | null; specialties: string[]; phone: string | null; notes: string | null },
  meta: RequestMeta
) {
  const isSelf = input.staffId === ctx.staffId;
  const isManager = ctx.permissions.has("staff.invite");
  if (!isSelf && !isManager) throw new ForbiddenError();
  return inTenant(ctx, async (tx) => {
    const s = await tx.staffMember.findFirst({ where: { id: input.staffId, status: "ACTIVE" }, select: { id: true, role: true } });
    if (!s) throw new NotFoundError("Staff member not found.");
    if (!isSelf && !assignableRoles(ctx.role).includes(s.role)) throw new ForbiddenError("Only the gym owner can edit this person's profile.");
    const crypto = staffCrypto(ctx.gym.id, s.id);
    await tx.staffMember.update({
      where: { id: s.id },
      data: {
        title: input.title,
        bio: input.bio,
        specialties: input.specialties,
        phoneEnc: crypto.enc("phone", input.phone),
        ...(isManager ? { notesEnc: crypto.enc("notes", input.notes) } : {}),
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, { action: "staff.profile_update", entityType: "StaffMember", entityId: s.id, changes: { fields: ["title", "bio", "specialties", "phone", ...(isManager ? ["notes"] : [])] } }, meta);
  });
}

export async function changeStaffRole(ctx: TenantContext, staffId: string, role: GymRole, meta: RequestMeta) {
  assertCan(ctx, "staff.manage");
  return inTenant(ctx, async (tx) => {
    // Lock all owners so two owners can't demote each other at the same moment.
    await tx.$queryRaw`SELECT id FROM "StaffMember" WHERE role = 'OWNER' AND status = 'ACTIVE' FOR UPDATE`;
    const target = await tx.staffMember.findFirst({ where: { id: staffId, status: "ACTIVE" }, select: { id: true, role: true, userId: true } });
    if (!target) throw new NotFoundError("Staff member not found.");
    const owners = await tx.staffMember.count({ where: { role: "OWNER", status: "ACTIVE" } });
    staffRule(() => assertCanChangeRole(ctx.role, { role: target.role, isSelf: target.id === ctx.staffId }, role, owners));
    await tx.staffMember.update({ where: { id: target.id }, data: { role }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "staff.role_change", entityType: "StaffMember", entityId: target.id, changes: { role: { from: target.role, to: role } } }, meta);
  });
}

/**
 * Remove someone from this gym. Their account is untouched (they may work at other gyms), but
 * access to this gym ends on their next request: every request re-checks ACTIVE membership.
 */
export async function removeStaff(ctx: TenantContext, staffId: string, meta: RequestMeta) {
  assertCan(ctx, "staff.manage");
  return inTenant(ctx, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "StaffMember" WHERE role = 'OWNER' AND status = 'ACTIVE' FOR UPDATE`;
    const target = await tx.staffMember.findFirst({ where: { id: staffId, status: "ACTIVE" }, select: { id: true, role: true } });
    if (!target) throw new NotFoundError("Staff member not found.");
    const owners = await tx.staffMember.count({ where: { role: "OWNER", status: "ACTIVE" } });
    staffRule(() => assertCanRemove(ctx.role, { role: target.role, isSelf: target.id === ctx.staffId }, owners));
    const futureClasses = await tx.classSession.count({ where: { trainerId: target.id, status: "SCHEDULED", startsAt: { gte: new Date() } } });
    await tx.staffMember.update({ where: { id: target.id }, data: { status: "REMOVED", removedAt: new Date() }, select: { id: true } });
    await tx.trainerClient.deleteMany({ where: { trainerId: target.id } });
    await recordAudit(tx, ctx, { action: "staff.remove", entityType: "StaffMember", entityId: target.id, changes: { role: target.role, futureClassesToReassign: futureClasses } }, meta);
    return { futureClasses };
  });
}

export async function assignClient(ctx: TenantContext, staffId: string, memberId: string, assign: boolean, meta: RequestMeta) {
  assertCan(ctx, "staff.invite");
  return inTenant(ctx, async (tx) => {
    const trainer = await tx.staffMember.findFirst({ where: { id: staffId, status: "ACTIVE", role: "TRAINER" }, select: { id: true } });
    if (!trainer) throw new ValidationError("Clients can only be assigned to active trainers.");
    const member = await tx.member.findFirst({ where: { id: memberId, deletedAt: null }, select: { id: true } });
    if (!member) throw new NotFoundError("Member not found.");
    if (assign) {
      await tx.trainerClient.upsert({ where: { trainerId_memberId: { trainerId: staffId, memberId } }, create: { gymId: ctx.gym.id, trainerId: staffId, memberId }, update: {}, select: { id: true } });
    } else {
      await tx.trainerClient.deleteMany({ where: { trainerId: staffId, memberId } });
    }
    await recordAudit(tx, ctx, { action: assign ? "trainer.client_assign" : "trainer.client_unassign", entityType: "StaffMember", entityId: staffId, changes: { memberId } }, meta);
  });
}

export async function addShift(ctx: TenantContext, input: { staffId: string; locationId: string; date: string; start: string; end: string }, meta: RequestMeta) {
  assertCan(ctx, "staff.invite");
  const tz = ctx.gym.timezone;
  const slot = { startsAt: localDateTime(input.date, input.start, tz), endsAt: localDateTime(input.date, input.end, tz) };
  return inTenant(ctx, async (tx) => {
    const staff = await tx.staffMember.findFirst({ where: { id: input.staffId, status: "ACTIVE" }, select: { id: true } });
    if (!staff) throw new NotFoundError("Staff member not found.");
    const location = await tx.location.findFirst({ where: { id: input.locationId, isActive: true }, select: { id: true } });
    if (!location) throw new ValidationError("Choose a location.");
    const sameDay = await tx.staffShift.findMany({ where: { staffId: staff.id, startsAt: { lt: slot.endsAt }, endsAt: { gt: slot.startsAt } }, select: { startsAt: true, endsAt: true } });
    if (sameDay.some((s) => overlaps(s, slot))) throw new ValidationError("This overlaps another shift for the same person.");
    const shift = await tx.staffShift.create({ data: { gymId: ctx.gym.id, staffId: staff.id, locationId: location.id, ...slot }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "shift.create", entityType: "StaffShift", entityId: shift.id, changes: { staffId: staff.id, ...slot } }, meta);
    return shift;
  });
}

export async function deleteShift(ctx: TenantContext, shiftId: string, meta: RequestMeta) {
  assertCan(ctx, "staff.invite");
  return inTenant(ctx, async (tx) => {
    const shift = await tx.staffShift.findUnique({ where: { id: shiftId }, select: { id: true, staffId: true, startsAt: true } });
    if (!shift) throw new NotFoundError("Shift not found.");
    await tx.staffShift.delete({ where: { id: shiftId }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "shift.delete", entityType: "StaffShift", entityId: shiftId, changes: { staffId: shift.staffId, startsAt: shift.startsAt } }, meta);
  });
}

// ─────────────────────────────── Invitations ───────────────────────────────

/**
 * Invite someone by email. The single-use token goes only into the email (and is shown once to
 * the inviter); only its SHA-256 hash is stored. Pending invitations count toward the plan's
 * staff limit so a gym can't over-invite.
 */
export async function inviteStaff(ctx: TenantContext, input: { email: string; role: GymRole }, meta: RequestMeta) {
  assertCan(ctx, "staff.invite");
  if (!ctx.staffId) throw new ForbiddenError();
  const inviterId = ctx.staffId;
  staffRule(() => assertCanInvite(ctx.role, input.role));
  const token = randomBytes(32).toString("base64url");
  const link = `${getEnv().APP_URL}/invite/${token}`;

  const invitation = await inTenant(ctx, async (tx) => {
    const already = await tx.staffMember.findFirst({ where: { status: "ACTIVE", user: { email: input.email } }, select: { id: true } });
    if (already) throw new ValidationError("This person already works at this gym.", { email: ["Already a staff member here"] });

    // A new invitation replaces a pending one — but a manager can't replace an owner's invitation
    // for a role they couldn't have issued themselves.
    const previous = await tx.staffInvitation.findMany({ where: { email: input.email, acceptedAt: null, revokedAt: null }, select: { role: true } });
    if (previous.some((p) => !assignableRoles(ctx.role).includes(p.role))) {
      throw new ForbiddenError("The gym owner has already invited this person. Ask the owner to change or withdraw that invitation.");
    }
    await tx.staffInvitation.updateMany({ where: { email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const active = await tx.staffMember.count({ where: { status: "ACTIVE" } });
    const pending = await tx.staffInvitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    const plan = planLimitsOf(ctx);
    if (active + pending >= plan.maxStaff) throw new PlanLimitError(limitMessage(plan, "staff"));

    const created = await tx.staffInvitation.create({
      data: { gymId: ctx.gym.id, email: input.email, role: input.role, tokenHash: hashInviteToken(token), expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000), invitedById: inviterId },
      select: { id: true, expiresAt: true },
    });
    await recordAudit(tx, ctx, { action: "staff.invite", entityType: "StaffInvitation", entityId: created.id, changes: { email: input.email, role: input.role } }, meta);
    return created;
  });

  await getEmailProvider().send({
    to: input.email,
    subject: `You're invited to join ${ctx.gym.name} on FitCRM`,
    text: `${ctx.user.name} has invited you to join ${ctx.gym.name} as ${input.role.replace("_", " ").toLowerCase()}.\n\nAccept the invitation (valid for ${INVITATION_DAYS} days, single use):\n${link}\n\nIf you weren't expecting this, you can ignore this email.`,
  });
  return { invitationId: invitation.id, link, expiresAt: invitation.expiresAt };
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string, meta: RequestMeta) {
  assertCan(ctx, "staff.invite");
  return inTenant(ctx, async (tx) => {
    const inv = await tx.staffInvitation.findFirst({ where: { id: invitationId, acceptedAt: null, revokedAt: null }, select: { id: true, email: true, role: true } });
    if (!inv) throw new NotFoundError("Invitation not found.");
    if (!assignableRoles(ctx.role).includes(inv.role)) throw new ForbiddenError("Only the gym owner can withdraw this invitation.");
    await tx.staffInvitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "staff.invite_revoke", entityType: "StaffInvitation", entityId: inv.id, changes: { email: inv.email } }, meta);
  });
}

// ─────────────────────────────── My schedule ───────────────────────────────

export async function mySchedule(ctx: TenantContext, monday: string) {
  assertCan(ctx, "schedule.view");
  const tz = ctx.gym.timezone;
  const from = dayBounds(monday, tz).start;
  const to = dayBounds(addDays(monday, 6), tz).end;
  if (!ctx.staffId) return { shifts: [], classes: [] };
  const staffId = ctx.staffId;
  return inTenant(ctx, async (tx) => {
    const shifts = await tx.staffShift.findMany({ where: { staffId, startsAt: { gte: from, lt: to } }, orderBy: { startsAt: "asc" }, select: { id: true, startsAt: true, endsAt: true, location: { select: { name: true } } } });
    const classes = await tx.classSession.findMany({
      where: { trainerId: staffId, startsAt: { gte: from, lt: to } },
      orderBy: { startsAt: "asc" },
      select: { id: true, startsAt: true, endsAt: true, status: true, capacity: true, classType: { select: { name: true, color: true } }, room: { select: { name: true } }, _count: { select: { bookings: { where: { status: { in: ["BOOKED", "ATTENDED"] } } } } } },
    });
    return { shifts, classes };
  });
}
