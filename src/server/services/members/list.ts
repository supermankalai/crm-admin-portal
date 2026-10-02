import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { toDateString } from "@/domain/dates";
import { currentMembership, memberStatusOn } from "@/domain/membership";
import { parseMemberSearch } from "@/domain/member-search";
import { phoneBlindIndex } from "@/server/crypto";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import type { MemberStatusFilter } from "@/lib/validation/members";
import { memberCrypto, statusWhere, todayFor, visibilityWhere } from "./shared";

export const MEMBER_PAGE_SIZE = 25;
export const MEMBER_SORTS = { recent: "Newest first", name: "Name (A–Z)", number: "Member number" } as const;
export type MemberSort = keyof typeof MEMBER_SORTS;

export type MemberListFilters = { q?: string; status?: MemberStatusFilter; sort?: MemberSort; page?: number };

function searchWhere(ctx: TenantContext, q: string | undefined): Prisma.MemberWhereInput {
  const search = parseMemberSearch(q);
  switch (search.kind) {
    case "memberNumber":
      return { memberNumber: search.value };
    case "phone":
      // Encrypted phones are found by their per-gym blind index (exact match only).
      return { phoneBlindIndex: phoneBlindIndex(ctx.gym.id, search.normalised) ?? "__none__" };
    case "email":
      return { email: { contains: search.value, mode: "insensitive" } };
    case "name":
      return {
        AND: search.tokens.map((t) => ({
          OR: [{ firstName: { contains: t, mode: "insensitive" as const } }, { lastName: { contains: t, mode: "insensitive" as const } }],
        })),
      };
    default:
      return {};
  }
}

const ORDER: Record<MemberSort, Prisma.MemberOrderByWithRelationInput[]> = {
  recent: [{ joinedAt: "desc" }, { memberNumber: "desc" }],
  name: [{ lastName: "asc" }, { firstName: "asc" }],
  number: [{ memberNumber: "asc" }],
};

export async function listMembers(ctx: TenantContext, filters: MemberListFilters) {
  assertCan(ctx, "members.view");
  const today = todayFor(ctx);
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.MemberWhereInput = { AND: [visibilityWhere(ctx), statusWhere(filters.status, today), searchWhere(ctx, filters.q)] };

  return inTenant(ctx, async (tx) => {
    const total = await tx.member.count({ where });
    const rows = await tx.member.findMany({
      where,
      orderBy: ORDER[filters.sort ?? "recent"],
      skip: (page - 1) * MEMBER_PAGE_SIZE,
      take: MEMBER_PAGE_SIZE,
      select: {
        id: true,
        memberNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneEnc: true,
        photoFileId: true,
        joinedAt: true,
        memberships: {
          orderBy: { endDate: "desc" },
          take: 6,
          select: { id: true, status: true, startDate: true, endDate: true, cancelledAt: true, plan: { select: { name: true } }, freezes: { select: { startDate: true, endDate: true } } },
        },
        checkIns: { where: { result: "ALLOWED" }, orderBy: { checkedInAt: "desc" }, take: 1, select: { checkedInAt: true } },
      },
    });

    return {
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / MEMBER_PAGE_SIZE)),
      rows: rows.map((m) => {
        const memberships = m.memberships.map((s) => ({
          ...s,
          startDate: toDateString(s.startDate),
          endDate: toDateString(s.endDate),
          freezes: s.freezes.map((f) => ({ startDate: toDateString(f.startDate), endDate: toDateString(f.endDate) })),
        }));
        const current = currentMembership(memberships, today) ?? memberships[0] ?? null;
        return {
          id: m.id,
          memberNumber: m.memberNumber,
          name: `${m.firstName} ${m.lastName}`,
          email: m.email,
          phone: memberCrypto(ctx.gym.id, m.id).dec("phone", m.phoneEnc),
          photoFileId: m.photoFileId,
          joinedAt: m.joinedAt,
          status: memberStatusOn(memberships, today),
          planName: current?.plan.name ?? null,
          endDate: current?.endDate ?? null,
          cancelling: !!current?.cancelledAt,
          lastVisit: m.checkIns[0]?.checkedInAt ?? null,
        };
      }),
    };
  });
}

export type MemberListRow = Awaited<ReturnType<typeof listMembers>>["rows"][number];
