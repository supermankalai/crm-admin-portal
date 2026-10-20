import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { normalisePhone } from "@/domain/phone";
import { recordAudit } from "@/server/audit/tenant-audit";
import { encryptField, userPhoneBlindIndex } from "@/server/crypto";
import { getEmailProvider } from "@/server/email";
import { getEnv } from "@/server/env";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { inviteCodeHash, inviteLinkHash, newInviteCode, newOpaqueToken } from "@/server/mobile/crypto";
import { maskEmail } from "@/server/mobile/identifier";
import { assertFeature } from "@/server/plan/limits";
import type { RequestMeta } from "@/server/security/request-meta";
import { getSmsProvider, maskPhone } from "@/server/sms";
import { assertCan, assertWritable, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { memberCrypto } from "./members/shared";

/**
 * Inviting a member to the member app. The invite is bound to the member's email or phone on
 * record; whoever redeems it gets an account for exactly that identity. Only a hash of the link
 * token / front-desk code is stored. A new invite replaces any pending one for the member.
 */

export const INVITE_LINK_DAYS = 7;
export const INVITE_CODE_MINUTES = 30;
export type InviteChannel = "EMAIL" | "SMS" | "CODE";

export async function createMemberAppInvite(ctx: TenantContext, memberId: string, channel: InviteChannel, meta: RequestMeta) {
  assertCan(ctx, "members.editContact");
  assertWritable(ctx);
  assertFeature(ctx, "memberApp");
  if (!ctx.staffId) throw new ForbiddenError();
  const staffId = ctx.staffId;

  const prepared = await inTenant(ctx, async (tx) => {
    const member = await tx.member.findFirst({ where: { id: memberId, deletedAt: null }, select: { id: true, firstName: true, email: true, phoneEnc: true, appAccount: { select: { status: true } } } });
    if (!member) throw new NotFoundError("Member not found.");
    if (member.appAccount?.status === "ACTIVE") throw new ValidationError(`${member.firstName} already uses the app.`);

    const rawPhone = memberCrypto(ctx.gym.id, member.id).dec("phone", member.phoneEnc);
    const phone = rawPhone ? normalisePhone(rawPhone) : null;
    const email = member.email?.toLowerCase() ?? null;
    let bindTo: { email: string } | { phone: string };
    if (channel === "EMAIL") {
      if (!email) throw new ValidationError(`Add an email address for ${member.firstName} first, or send the invite by SMS.`);
      bindTo = { email };
    } else if (channel === "SMS") {
      if (!phone) throw new ValidationError(`Add a mobile number for ${member.firstName} first, or send the invite by email.`);
      bindTo = { phone };
    } else {
      if (!email && !phone) throw new ValidationError(`Add an email address or mobile number for ${member.firstName} first.`);
      bindTo = email ? { email } : { phone: phone! };
    }

    const inviteId = createId();
    const secret = channel === "CODE" ? newInviteCode() : newOpaqueToken();
    const tokenHash = channel === "CODE" ? inviteCodeHash(secret) : inviteLinkHash(secret);
    const expiresAt = new Date(Date.now() + (channel === "CODE" ? INVITE_CODE_MINUTES * 60_000 : INVITE_LINK_DAYS * 86_400_000));

    await tx.memberAppInvite.updateMany({ where: { memberId: member.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.memberAppInvite.create({
      data: {
        id: inviteId,
        gymId: ctx.gym.id,
        memberId: member.id,
        channel,
        tokenHash,
        email: "email" in bindTo ? bindTo.email : null,
        phoneEnc: "phone" in bindTo ? encryptField(bindTo.phone, { gymId: ctx.gym.id, model: "MemberAppInvite", field: "phone", recordId: inviteId }) : null,
        phoneBlindIndex: "phone" in bindTo ? userPhoneBlindIndex(bindTo.phone) : null,
        expiresAt,
        createdById: staffId,
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, { action: "member.app_invite", entityType: "Member", entityId: member.id, changes: { channel, inviteId, expiresAt: expiresAt.toISOString() } }, meta);
    return { inviteId, secret, expiresAt, firstName: member.firstName, bindTo };
  });

  const link = `${getEnv().APP_URL}/app/invite/${prepared.secret}`;
  let sentTo: string | null = null;
  if (channel === "EMAIL" && "email" in prepared.bindTo) {
    await getEmailProvider().send({
      to: prepared.bindTo.email,
      subject: `${ctx.gym.name} invited you to the member app`,
      text: `Hi ${prepared.firstName},\n\n${ctx.gym.name} has invited you to the FitCRM member app: your membership card, class bookings and workouts in one place.\n\nOpen this link on your phone to set up your account (valid for ${INVITE_LINK_DAYS} days):\n${link}\n\nIf you weren't expecting this, you can ignore this email.`,
    });
    sentTo = maskEmail(prepared.bindTo.email);
  } else if (channel === "SMS" && "phone" in prepared.bindTo) {
    await getSmsProvider().send({ to: prepared.bindTo.phone, text: `${ctx.gym.name} invited you to the FitCRM member app. Set up your account (valid ${INVITE_LINK_DAYS} days): ${link}` });
    sentTo = maskPhone(prepared.bindTo.phone);
  }

  return {
    inviteId: prepared.inviteId,
    channel,
    expiresAt: prepared.expiresAt.toISOString(),
    // The front-desk code is shown once to the staff member and never stored in clear.
    code: channel === "CODE" ? prepared.secret : null,
    sentTo,
  };
}

/** The member's app status for the web profile: account (if any) and any pending invite. */
export async function memberAppStatus(ctx: TenantContext, memberId: string) {
  return inTenant(ctx, async (tx) => {
    const [account, invite] = await Promise.all([
      tx.memberAccount.findFirst({ where: { memberId }, select: { status: true, lastLoginAt: true, createdAt: true } }),
      tx.memberAppInvite.findFirst({ where: { memberId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { channel: true, expiresAt: true } }),
    ]);
    return { account, invite };
  });
}

/**
 * Turn a member's app access off (lost phone, left the gym) or back on. Off takes effect on their
 * next request: the server re-checks the account every time.
 */
export async function setMemberAppAccess(ctx: TenantContext, memberId: string, enabled: boolean, meta: RequestMeta) {
  assertCan(ctx, "members.editContact");
  assertWritable(ctx);
  return inTenant(ctx, async (tx) => {
    const account = await tx.memberAccount.findFirst({ where: { memberId, member: { deletedAt: null } }, select: { id: true, status: true } });
    if (!account) throw new NotFoundError("This member hasn't set up the app.");
    const status = enabled ? "ACTIVE" : "DISABLED";
    if (account.status !== status) {
      await tx.memberAccount.update({ where: { id: account.id }, data: { status }, select: { id: true } });
      await recordAudit(tx, ctx, { action: enabled ? "member.app_enabled" : "member.app_disabled", entityType: "Member", entityId: memberId }, meta);
    }
    return { status };
  });
}
