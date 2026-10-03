import "server-only";
import type { PlanSummary, TenantContext } from "./types";
import type { SubscriptionAccess } from "@/domain/subscription-access";
import { withMember, withUser, type Tx } from "@/server/db/context";
import { buildContext, GYM_SELECT } from "./resolve";

type UserLike = { id: string; name: string; email: string; isSuperAdmin: boolean };

/**
 * A member using the member app in one gym. Built only from the verified token's user and an
 * ACTIVE MemberAccount in that gym; the database independently re-checks the member on every
 * query (app_current_member_id()), so a disabled account or deleted member gets nothing.
 */
export type MemberContext = {
  kind: "member";
  user: UserLike;
  gym: TenantContext["gym"];
  plan: PlanSummary | null;
  access: SubscriptionAccess;
  memberId: string;
  memberAccountId: string;
};

export async function resolveMemberContext(user: UserLike, gym: { slug: string } | { id: string }, now = new Date()): Promise<MemberContext | null> {
  const account = await withUser(user.id, (tx) =>
    tx.memberAccount.findFirst({
      where: { userId: user.id, status: "ACTIVE", gym },
      select: { id: true, memberId: true, gym: { select: GYM_SELECT } },
    })
  );
  if (!account) return null;
  const member = await withMember({ userId: user.id, gymId: account.gym.id, memberId: account.memberId }, (tx) =>
    tx.member.findFirst({ where: { id: account.memberId }, select: { id: true } })
  );
  if (!member) return null;
  // Gym, plan and subscription access are computed exactly as for staff.
  const shared = buildContext(user, account.gym, "OWNER", null, null, now);
  return { kind: "member", user, gym: shared.gym, plan: shared.plan, access: shared.access, memberId: account.memberId, memberAccountId: account.id };
}

/** Run queries as this member in their gym (member-scoped RLS). */
export function inMember<T>(ctx: MemberContext, fn: (tx: Tx) => Promise<T>) {
  return withMember({ userId: ctx.user.id, gymId: ctx.gym.id, memberId: ctx.memberId }, fn);
}
