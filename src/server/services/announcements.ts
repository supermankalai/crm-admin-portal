import "server-only";
import { dedupeKey } from "@/domain/notifications";
import type { AnnouncementInput } from "@/lib/validation/announcements";
import { recordAudit } from "@/server/audit/tenant-audit";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { inAppChannel, type OutgoingNotification } from "@/server/notifications";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, assertWritable, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";

/**
 * Gym announcements. Publishing puts one notification in each recipient's inbox (members with
 * the member app, and/or staff); the push job then alerts their devices with the title only.
 * Announcements are gym-public: not encrypted, so staff are told not to include personal data.
 */

export async function listGymAnnouncements(ctx: TenantContext) {
  return inTenant(ctx, (tx) =>
    tx.announcement.findMany({
      orderBy: { publishedAt: "desc" },
      take: 100,
      select: { id: true, title: true, body: true, audience: true, publishedAt: true, createdBy: { select: { user: { select: { name: true } } } } },
    })
  );
}

export async function publishAnnouncement(ctx: TenantContext, input: AnnouncementInput, meta: RequestMeta) {
  assertCan(ctx, "announcements.manage");
  assertWritable(ctx);
  if (!ctx.staffId) throw new ForbiddenError("Only gym staff can publish announcements.");
  const staffId = ctx.staffId;
  return inTenant(ctx, async (tx) => {
    const a = await tx.announcement.create({ data: { gymId: ctx.gym.id, title: input.title, body: input.body, audience: input.audience, createdById: staffId }, select: { id: true } });
    const recipients = new Set<string>();
    if (input.audience !== "STAFF") {
      for (const m of await tx.memberAccount.findMany({ where: { status: "ACTIVE", member: { deletedAt: null } }, select: { userId: true } })) recipients.add(m.userId);
    }
    if (input.audience !== "MEMBERS") {
      for (const s of await tx.staffMember.findMany({ where: { status: "ACTIVE" }, select: { userId: true } })) if (s.userId !== ctx.user.id) recipients.add(s.userId);
    }
    const messages: OutgoingNotification[] = [...recipients].map((userId) => ({
      gymId: ctx.gym.id,
      recipientUserId: userId,
      type: "ANNOUNCEMENT",
      title: input.title,
      body: input.body.length > 280 ? `${input.body.slice(0, 279)}…` : input.body,
      entityType: "Announcement",
      entityId: a.id,
      dedupeKey: dedupeKey("ANNOUNCEMENT", a.id, userId),
    }));
    const delivered = await inAppChannel.send(tx, messages);
    await recordAudit(tx, ctx, { action: "announcement.publish", entityType: "Announcement", entityId: a.id, changes: { audience: input.audience, recipients: delivered } }, meta);
    return { id: a.id, recipients: delivered };
  });
}

/** Removes the announcement from the app's list. Inbox copies already delivered stay. */
export async function deleteAnnouncement(ctx: TenantContext, announcementId: string, meta: RequestMeta) {
  assertCan(ctx, "announcements.manage");
  assertWritable(ctx);
  return inTenant(ctx, async (tx) => {
    const { count } = await tx.announcement.deleteMany({ where: { id: announcementId } });
    if (!count) throw new NotFoundError("Announcement not found.");
    await recordAudit(tx, ctx, { action: "announcement.delete", entityType: "Announcement", entityId: announcementId }, meta);
    return { deleted: true };
  });
}
