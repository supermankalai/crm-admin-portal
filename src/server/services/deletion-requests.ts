import "server-only";
import { formatMemberNumber } from "@/domain/member-search";
import { recordAudit } from "@/server/audit/tenant-audit";
import { tryDecrypt } from "@/server/crypto";
import { ConflictError, NotFoundError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { getStorage } from "@/server/storage";
import { assertCan, assertWritable, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";

/**
 * Account deletion requests from the member app, handled by owners and managers.
 *
 * Completing one: the member is anonymised (name, contact details, date of birth, health notes,
 * emergency contact and photo removed; soft-deleted), their app account is disabled, and their
 * fitness data (measurements, progress photos, workouts, trainer notes), inbox and devices for
 * this gym are erased. Money records (invoices, payments) and attendance are kept — the gym needs
 * them for its accounts — but no longer carry the person's name.
 */

const reasonCtx = (gymId: string, id: string) => ({ gymId, model: "AccountDeletionRequest", field: "reason", recordId: id });

export async function listDeletionRequests(ctx: TenantContext) {
  assertCan(ctx, "members.delete");
  const rows = await inTenant(ctx, (tx) =>
    tx.accountDeletionRequest.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        status: true,
        reasonEnc: true,
        createdAt: true,
        resolvedAt: true,
        resolutionNote: true,
        member: { select: { id: true, firstName: true, lastName: true, memberNumber: true } },
        resolvedBy: { select: { user: { select: { name: true } } } },
      },
    })
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    reason: tryDecrypt(r.reasonEnc, reasonCtx(ctx.gym.id, r.id)),
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    resolutionNote: r.resolutionNote,
    resolvedBy: r.resolvedBy?.user.name ?? null,
    member: { id: r.member.id, name: `${r.member.firstName} ${r.member.lastName}`, memberNumber: formatMemberNumber(r.member.memberNumber) },
  }));
}

export async function openDeletionRequestCount(ctx: TenantContext) {
  if (!ctx.permissions.has("members.delete")) return 0;
  return inTenant(ctx, (tx) => tx.accountDeletionRequest.count({ where: { status: "REQUESTED" } }));
}

async function openRequest(tx: Parameters<Parameters<typeof inTenant>[1]>[0], requestId: string) {
  const r = await tx.accountDeletionRequest.findFirst({ where: { id: requestId }, select: { id: true, status: true, memberId: true, member: { select: { memberNumber: true, photoFileId: true } } } });
  if (!r) throw new NotFoundError("Request not found.");
  if (r.status !== "REQUESTED") throw new ConflictError("This request has already been handled.");
  return r;
}

export async function completeDeletionRequest(ctx: TenantContext, requestId: string, note: string | null, meta: RequestMeta) {
  assertCan(ctx, "members.delete");
  assertWritable(ctx);
  const files = await inTenant(ctx, async (tx) => {
    const r = await openRequest(tx, requestId);
    // Fitness data, inbox and devices (via the definer function: managers can't read photos).
    const photos = await tx.$queryRaw<{ storage_key: string }[]>`SELECT storage_key FROM erase_member_fitness_data(${r.memberId})`;
    const photo = r.member.photoFileId ? await tx.fileAsset.findUnique({ where: { id: r.member.photoFileId }, select: { id: true, storageKey: true } }) : null;
    await tx.member.update({
      where: { id: r.memberId },
      data: {
        firstName: "Deleted",
        lastName: `member ${formatMemberNumber(r.member.memberNumber)}`,
        email: null,
        phoneEnc: null,
        phoneBlindIndex: null,
        addressEnc: null,
        dateOfBirthEnc: null,
        healthNotesEnc: null,
        emergencyContactEnc: null,
        photoFileId: null,
        deletedAt: new Date(),
      },
      select: { id: true },
    });
    if (photo) await tx.fileAsset.delete({ where: { id: photo.id } });
    await tx.memberNote.deleteMany({ where: { memberId: r.memberId } });
    await tx.memberAccount.updateMany({ where: { memberId: r.memberId }, data: { status: "DISABLED" } });
    await tx.memberAppInvite.updateMany({ where: { memberId: r.memberId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.accountDeletionRequest.update({ where: { id: r.id }, data: { status: "COMPLETED", resolvedAt: new Date(), resolvedById: ctx.staffId, resolutionNote: note, reasonEnc: null }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "member.erase", entityType: "Member", entityId: r.memberId, changes: { requestId: r.id, photos: photos.length } }, meta);
    return [...photos.map((p) => p.storage_key), ...(photo ? [photo.storageKey] : [])];
  });
  // Files go once the database change is committed.
  const storage = getStorage();
  for (const key of files) await storage.remove(key);
  return { completed: true };
}

export async function rejectDeletionRequest(ctx: TenantContext, requestId: string, note: string | null, meta: RequestMeta) {
  assertCan(ctx, "members.delete");
  assertWritable(ctx);
  return inTenant(ctx, async (tx) => {
    const r = await openRequest(tx, requestId);
    await tx.accountDeletionRequest.update({ where: { id: r.id }, data: { status: "REJECTED", resolvedAt: new Date(), resolvedById: ctx.staffId, resolutionNote: note }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "member.erase_rejected", entityType: "Member", entityId: r.memberId, changes: { requestId: r.id } }, meta);
    return { rejected: true };
  });
}
