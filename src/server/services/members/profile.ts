import "server-only";
import { toDateString } from "@/domain/dates";
import { freezeDaysUsed, membershipStateOn, memberStatusOn } from "@/domain/membership";
import { tryDecrypt } from "@/server/crypto";
import { NotFoundError } from "@/server/errors";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { memberCrypto, todayFor, visibilityWhere } from "./shared";

/**
 * Everything on the member profile, decrypted for display. Sections the role may not see
 * (payments for trainers; health notes for front desk) are not even queried.
 */
export async function getMemberProfile(ctx: TenantContext, memberId: string) {
  assertCan(ctx, "members.view");
  const today = todayFor(ctx);
  const canSeePayments = ctx.permissions.has("payments.view");
  const canSeeHealth = ctx.permissions.has("members.edit") || ctx.permissions.has("members.notes");
  const canSeeNotes = ctx.permissions.has("members.notes") || ctx.permissions.has("members.edit");

  return inTenant(ctx, async (tx) => {
    const member = await tx.member.findFirst({ where: { id: memberId, ...visibilityWhere(ctx) } });
    if (!member) throw new NotFoundError("Member not found.");

    const memberships = await tx.membership.findMany({
      where: { memberId },
      orderBy: { startDate: "desc" },
      include: {
        plan: { select: { name: true, type: true, allowFreeze: true, maxFreezeDays: true, cancellationNoticeDays: true, cancellationFeeMinor: true, classCredits: true } },
        freezes: { orderBy: { startDate: "asc" }, select: { id: true, startDate: true, endDate: true, reason: true } },
      },
    });
    const checkIns = await tx.checkIn.findMany({
      where: { memberId },
      orderBy: { checkedInAt: "desc" },
      take: 30,
      select: { id: true, checkedInAt: true, result: true, method: true, location: { select: { name: true } } },
    });
    const visits30d = await tx.checkIn.count({ where: { memberId, result: "ALLOWED", checkedInAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } });
    const visitsTotal = await tx.checkIn.count({ where: { memberId, result: "ALLOWED" } });
    const trainers = await tx.trainerClient.findMany({ where: { memberId }, select: { trainer: { select: { id: true, user: { select: { name: true } } } } } });
    const notes = canSeeNotes
      ? await tx.memberNote.findMany({
          where: { memberId },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, bodyEnc: true, createdAt: true, author: { select: { role: true, user: { select: { name: true } } } } },
        })
      : [];
    const payments = canSeePayments
      ? await tx.payment.findMany({
          where: { memberId, deletedAt: null },
          orderBy: { receivedAt: "desc" },
          take: 50,
          select: { id: true, amountMinor: true, currency: true, method: true, status: true, receivedAt: true, reference: true, invoice: { select: { number: true } }, refunds: { select: { amountMinor: true } } },
        })
      : [];
    const openInvoices = canSeePayments
      ? await tx.invoice.findMany({
          where: { memberId, status: "OPEN", deletedAt: null },
          orderBy: { dueDate: "asc" },
          select: { id: true, number: true, totalMinor: true, amountPaidMinor: true, dueDate: true, currency: true },
        })
      : [];

    const crypto = memberCrypto(ctx.gym.id, member.id);
    const membershipRecords = memberships.map((s) => ({
      ...s,
      startDate: toDateString(s.startDate),
      endDate: toDateString(s.endDate),
      freezes: s.freezes.map((f) => ({ ...f, startDate: toDateString(f.startDate), endDate: toDateString(f.endDate) })),
    }));

    return {
      today,
      member: {
        id: member.id,
        memberNumber: member.memberNumber,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        phone: crypto.dec("phone", member.phoneEnc),
        address: crypto.dec("address", member.addressEnc),
        dateOfBirth: crypto.dec("dateOfBirth", member.dateOfBirthEnc),
        emergencyContact: crypto.decEmergency(member.emergencyContactEnc),
        healthNotes: canSeeHealth ? crypto.dec("healthNotes", member.healthNotesEnc) : null,
        hasHealthNotes: !!member.healthNotesEnc,
        photoFileId: member.photoFileId,
        checkInCode: member.checkInCode,
        joinedAt: member.joinedAt,
      },
      status: memberStatusOn(membershipRecords, today),
      memberships: membershipRecords.map((s) => ({
        id: s.id,
        planName: s.plan.name,
        planType: s.plan.type,
        startDate: s.startDate,
        endDate: s.endDate,
        priceMinor: s.priceMinor,
        classCreditsRemaining: s.classCreditsRemaining,
        cancelledAt: s.cancelledAt,
        cancelReason: s.cancelReason,
        state: membershipStateOn(s, today),
        freezes: s.freezes,
        freeze: { allowed: s.plan.allowFreeze, maxDays: s.plan.maxFreezeDays, usedDays: freezeDaysUsed(s) },
        cancellation: { noticeDays: s.plan.cancellationNoticeDays, feeMinor: s.plan.cancellationFeeMinor },
      })),
      checkIns,
      visits: { last30Days: visits30d, total: visitsTotal },
      trainers: trainers.map((t) => ({ id: t.trainer.id, name: t.trainer.user.name })),
      notes: notes.map((n) => ({
        id: n.id,
        body: tryDecrypt(n.bodyEnc, { gymId: ctx.gym.id, model: "MemberNote", field: "body", recordId: n.id }) ?? "[This note could not be decrypted]",
        createdAt: n.createdAt,
        author: n.author.user.name,
        authorRole: n.author.role,
      })),
      payments: payments.map((p) => ({ ...p, refundedMinor: p.refunds.reduce((sum, r) => sum + r.amountMinor, 0) })),
      openInvoices,
      permissions: { canSeePayments, canSeeHealth, canSeeNotes },
    };
  });
}

export type MemberProfile = Awaited<ReturnType<typeof getMemberProfile>>;
