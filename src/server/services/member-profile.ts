import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { formatMemberNumber } from "@/domain/member-search";
import { dedupeKey, deletionRequestText } from "@/domain/notifications";
import type { MemberInput } from "@/lib/validation/members";
import { recordMemberAudit } from "@/server/audit/tenant-audit";
import { encryptOptional, phoneBlindIndex } from "@/server/crypto";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { inAppChannel } from "@/server/notifications";
import type { RequestMeta } from "@/server/security/request-meta";
import { inMember, inMemberAction, type MemberContext } from "@/server/tenant/member";
import { assertMemberWritable } from "./fitness/common";
import { isUniqueViolation, memberCrypto, type EmergencyContact } from "./members/shared";

/**
 * A member's own profile in the app: contact details, emergency contact, and asking the gym to
 * delete their account. Members can't update the Member table directly; contact changes go
 * through member_update_own_contact() (only those columns, only their own row) with values the
 * app server has already encrypted.
 */

type Contact = Pick<MemberInput, "email" | "phone" | "address" | "emergencyContact">;

const EMAIL_TAKEN = "Another member of this gym already uses this email address.";

export async function memberProfile(ctx: MemberContext) {
  const crypto = memberCrypto(ctx.gym.id, ctx.memberId);
  return inMember(ctx, async (tx) => {
    const m = await tx.member.findFirst({
      where: { id: ctx.memberId, deletedAt: null },
      select: { firstName: true, lastName: true, memberNumber: true, email: true, phoneEnc: true, addressEnc: true, emergencyContactEnc: true },
    });
    if (!m) throw new NotFoundError("Member not found.");
    const request = await tx.accountDeletionRequest.findFirst({ where: { memberId: ctx.memberId }, orderBy: { createdAt: "desc" }, select: { status: true, createdAt: true, resolutionNote: true } });
    return {
      name: `${m.firstName} ${m.lastName}`,
      memberNumber: formatMemberNumber(m.memberNumber),
      email: m.email,
      phone: crypto.dec("phone", m.phoneEnc),
      address: crypto.dec("address", m.addressEnc),
      emergencyContact: crypto.decEmergency(m.emergencyContactEnc),
      deletionRequest: request ? { status: request.status, requestedAt: request.createdAt.toISOString(), note: request.status === "REJECTED" ? request.resolutionNote : null } : null,
    };
  });
}

export async function updateMemberProfile(ctx: MemberContext, input: Contact, meta: RequestMeta) {
  assertMemberWritable(ctx);
  const before = await memberProfile(ctx);
  const crypto = memberCrypto(ctx.gym.id, ctx.memberId);
  const emergency: EmergencyContact | null = input.emergencyContact?.name ? input.emergencyContact : null;
  const changed = (
    [
      ["email", before.email, input.email],
      ["phone", before.phone, input.phone],
      ["address", before.address, input.address],
      ["emergencyContact", JSON.stringify(before.emergencyContact), JSON.stringify(emergency)],
    ] as const
  )
    .filter(([, a, b]) => (a ?? null) !== (b ?? null))
    .map(([field]) => field);
  if (!changed.length) return before;
  try {
    await inMemberAction(ctx, async (tx) => {
      await tx.$executeRaw`SELECT member_update_own_contact(
        ${input.email},
        ${crypto.enc("phone", input.phone)},
        ${phoneBlindIndex(ctx.gym.id, input.phone)},
        ${encryptOptional(input.address, { gymId: ctx.gym.id, model: "Member", field: "address", recordId: ctx.memberId })},
        ${crypto.encEmergency(emergency)}
      )`;
      // Field names only — never the old or new values.
      await recordMemberAudit(tx, ctx, { action: "member.self_update", entityType: "Member", entityId: ctx.memberId, changes: { fields: changed } }, meta);
    });
  } catch (error) {
    if (isUniqueViolation(error, "emailKey")) throw new ValidationError(EMAIL_TAKEN, { email: [EMAIL_TAKEN] });
    throw error;
  }
  return memberProfile(ctx);
}

/** File a deletion request; the gym's owners and managers are told in their inbox. */
export async function requestAccountDeletion(ctx: MemberContext, reason: string | null, meta: RequestMeta) {
  const id = createId();
  try {
    return await inMemberAction(ctx, async (tx) => {
      const row = await tx.accountDeletionRequest.create({
        data: {
          id,
          gymId: ctx.gym.id,
          memberId: ctx.memberId,
          userId: ctx.user.id,
          reasonEnc: encryptOptional(reason, { gymId: ctx.gym.id, model: "AccountDeletionRequest", field: "reason", recordId: id }),
        },
        select: { createdAt: true },
      });
      const managers = await tx.$queryRaw<{ gym_manager_user_ids: string }[]>`SELECT gym_manager_user_ids()`;
      await inAppChannel.send(
        tx,
        managers.map((m) => ({
          gymId: ctx.gym.id,
          recipientUserId: m.gym_manager_user_ids,
          type: "DELETION_REQUEST" as const,
          ...deletionRequestText(),
          entityType: "AccountDeletionRequest",
          entityId: id,
          dedupeKey: dedupeKey("DELETION_REQUEST", id, m.gym_manager_user_ids),
        }))
      );
      await recordMemberAudit(tx, ctx, { action: "account.deletion_requested", entityType: "AccountDeletionRequest", entityId: id }, meta);
      return { status: "REQUESTED" as const, requestedAt: row.createdAt.toISOString() };
    });
  } catch (error) {
    if (isUniqueViolation(error, "one_open")) throw new ConflictError("You've already asked for your account to be deleted. The gym will be in touch.");
    throw error;
  }
}
