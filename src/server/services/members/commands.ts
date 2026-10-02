import "server-only";
import { randomBytes } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { phoneBlindIndex, encryptField } from "@/server/crypto";
import { recordAudit } from "@/server/audit/tenant-audit";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { assertWithinLimit } from "@/server/plan/limits";
import type { RequestMeta } from "@/server/security/request-meta";
import { getStorage, inspectImage, storageKey } from "@/server/storage";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import type { MemberInput } from "@/lib/validation/members";
import { assertMemberVisible, isUniqueViolation, memberCrypto, visibilityWhere, type EmergencyContact } from "./shared";

const EMAIL_TAKEN = "A member with this email already exists in this gym.";

/** Unambiguous check-in / QR code (no 0/O/1/I). */
function newCheckInCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
}

function emergencyOrNull(c: EmergencyContact | undefined): EmergencyContact | null {
  return c && c.name && c.phone ? c : null;
}

export async function createMember(ctx: TenantContext, input: MemberInput, meta: RequestMeta) {
  assertCan(ctx, "members.create");
  const id = createId();
  const crypto = memberCrypto(ctx.gym.id, id);
  try {
    return await inTenant(ctx, async (tx) => {
      await assertWithinLimit(ctx, tx, "members");
      const counter = await tx.gymCounter.update({
        where: { gymId_key: { gymId: ctx.gym.id, key: "member" } },
        data: { value: { increment: 1 } },
        select: { value: true },
      });
      await tx.member.create({
        data: {
          id,
          gymId: ctx.gym.id,
          memberNumber: counter.value,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phoneEnc: crypto.enc("phone", input.phone),
          phoneBlindIndex: phoneBlindIndex(ctx.gym.id, input.phone),
          addressEnc: crypto.enc("address", input.address),
          dateOfBirthEnc: crypto.enc("dateOfBirth", input.dateOfBirth),
          emergencyContactEnc: crypto.encEmergency(emergencyOrNull(input.emergencyContact)),
          healthNotesEnc: crypto.enc("healthNotes", input.healthNotes),
          checkInCode: newCheckInCode(),
        },
        select: { id: true },
      });
      await recordAudit(tx, ctx, { action: "member.create", entityType: "Member", entityId: id, changes: { memberNumber: counter.value } }, meta);
      return { id, memberNumber: counter.value };
    });
  } catch (error) {
    if (isUniqueViolation(error, "emailKey")) throw new ValidationError(EMAIL_TAKEN, { email: [EMAIL_TAKEN] });
    throw error;
  }
}

const CONTACT_FIELDS = ["email", "phone", "address", "emergencyContact"] as const;

/**
 * Update a member. Roles with only members.editContact (front desk) may change contact
 * fields; any other field in the request is refused, not silently ignored.
 */
export async function updateMember(
  ctx: TenantContext,
  memberId: string,
  input: Partial<MemberInput>,
  meta: RequestMeta
) {
  const fullEdit = ctx.permissions.has("members.edit");
  if (!fullEdit) {
    assertCan(ctx, "members.editContact");
    const extra = Object.keys(input).filter((k) => !(CONTACT_FIELDS as readonly string[]).includes(k));
    if (extra.length) throw new ForbiddenError("Your role can only change contact details.");
  }
  const crypto = memberCrypto(ctx.gym.id, memberId);
  try {
    return await inTenant(ctx, async (tx) => {
      const current = await tx.member.findFirst({ where: { id: memberId, ...visibilityWhere(ctx) } });
      if (!current) throw new NotFoundError("Member not found.");

      const before = {
        firstName: current.firstName,
        lastName: current.lastName,
        email: current.email,
        phone: crypto.dec("phone", current.phoneEnc),
        address: crypto.dec("address", current.addressEnc),
        dateOfBirth: crypto.dec("dateOfBirth", current.dateOfBirthEnc),
        healthNotes: crypto.dec("healthNotes", current.healthNotesEnc),
        emergencyContact: JSON.stringify(crypto.decEmergency(current.emergencyContactEnc)),
      };
      const after = { ...before, ...input, emergencyContact: input.emergencyContact !== undefined ? JSON.stringify(emergencyOrNull(input.emergencyContact)) : before.emergencyContact };
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => input[k as keyof MemberInput] !== undefined && after[k] !== before[k]);
      if (!changed.length) return { changed: [] as string[] };

      const data: Record<string, unknown> = {};
      for (const field of changed) {
        if (field === "firstName" || field === "lastName" || field === "email") data[field] = input[field];
        else if (field === "phone") {
          data.phoneEnc = crypto.enc("phone", input.phone ?? null);
          data.phoneBlindIndex = phoneBlindIndex(ctx.gym.id, input.phone ?? null);
        } else if (field === "emergencyContact") data.emergencyContactEnc = crypto.encEmergency(emergencyOrNull(input.emergencyContact));
        else data[`${field}Enc`] = crypto.enc(field, (input[field] as string | null | undefined) ?? null);
      }
      await tx.member.update({ where: { id: memberId }, data, select: { id: true } });
      // Field names only — never the old or new personal values.
      await recordAudit(tx, ctx, { action: "member.update", entityType: "Member", entityId: memberId, changes: { fields: changed } }, meta);
      return { changed: changed as string[] };
    });
  } catch (error) {
    if (isUniqueViolation(error, "emailKey")) throw new ValidationError(EMAIL_TAKEN, { email: [EMAIL_TAKEN] });
    throw error;
  }
}

/** Soft delete: the member disappears from lists but history (payments, visits) is kept. */
export async function softDeleteMember(ctx: TenantContext, memberId: string, meta: RequestMeta) {
  assertCan(ctx, "members.delete");
  return inTenant(ctx, async (tx) => {
    await assertMemberVisible(tx, ctx, memberId);
    await tx.member.update({ where: { id: memberId }, data: { deletedAt: new Date() }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "member.delete", entityType: "Member", entityId: memberId, changes: { soft: true } }, meta);
  });
}

export async function addMemberNote(ctx: TenantContext, memberId: string, body: string, meta: RequestMeta) {
  assertCan(ctx, "members.notes");
  if (!ctx.staffId) throw new ForbiddenError();
  const staffId = ctx.staffId;
  const id = createId();
  return inTenant(ctx, async (tx) => {
    await assertMemberVisible(tx, ctx, memberId); // trainers: own clients only
    await tx.memberNote.create({
      data: { id, gymId: ctx.gym.id, memberId, authorId: staffId, bodyEnc: encryptField(body, { gymId: ctx.gym.id, model: "MemberNote", field: "body", recordId: id }) },
      select: { id: true },
    });
    await recordAudit(tx, ctx, { action: "member.note_add", entityType: "Member", entityId: memberId, changes: { noteId: id } }, meta);
    return { id };
  });
}

/** Replace a member's photo. The file type is detected from its bytes; max 2 MB. */
export async function setMemberPhoto(ctx: TenantContext, memberId: string, bytes: Buffer, meta: RequestMeta) {
  if (!ctx.permissions.has("members.edit")) assertCan(ctx, "members.editContact");
  if (!ctx.staffId) throw new ForbiddenError();
  const staffId = ctx.staffId;
  const image = inspectImage(bytes);
  const key = storageKey(ctx.gym.id, "member-photo", image.ext);
  const storage = getStorage();
  await storage.put(key, bytes);
  try {
    const oldKey = await inTenant(ctx, async (tx) => {
      const member = await tx.member.findFirst({ where: { id: memberId, ...visibilityWhere(ctx) }, select: { photo: { select: { id: true, storageKey: true } } } });
      if (!member) throw new NotFoundError("Member not found.");
      const asset = await tx.fileAsset.create({
        data: { gymId: ctx.gym.id, kind: "MEMBER_PHOTO", storageKey: key, mimeType: image.mimeType, sizeBytes: bytes.length, sha256: image.sha256, uploadedById: staffId },
        select: { id: true },
      });
      await tx.member.update({ where: { id: memberId }, data: { photoFileId: asset.id }, select: { id: true } });
      if (member.photo) await tx.fileAsset.delete({ where: { id: member.photo.id }, select: { id: true } });
      await recordAudit(tx, ctx, { action: "member.photo_update", entityType: "Member", entityId: memberId, changes: { fileId: asset.id, bytes: bytes.length } }, meta);
      return member.photo?.storageKey ?? null;
    });
    if (oldKey) await storage.remove(oldKey);
  } catch (error) {
    await storage.remove(key); // don't leave orphaned files behind
    throw error;
  }
}

/** Read a stored file for the current gym (RLS scopes the lookup to this gym). */
export async function readGymFile(ctx: TenantContext, fileId: string) {
  const asset = await inTenant(ctx, async (tx) => {
    const found = await tx.fileAsset.findUnique({ where: { id: fileId }, select: { storageKey: true, mimeType: true, kind: true } });
    // Member photos follow member visibility (trainers: own clients only).
    if (found?.kind === "MEMBER_PHOTO" && !ctx.permissions.has("members.viewAll")) {
      const visible = await tx.member.count({ where: { photoFileId: fileId, ...visibilityWhere(ctx) } });
      if (!visible) return null;
    }
    return found;
  });
  if (!asset) return null;
  return { ...asset, bytes: await getStorage().get(asset.storageKey) };
}
