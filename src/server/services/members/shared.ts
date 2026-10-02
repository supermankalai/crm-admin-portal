import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { fromDateString, localDate, type DateString } from "@/domain/dates";
import { encryptJson, encryptOptional, tryDecrypt } from "@/server/crypto";
import { NotFoundError } from "@/server/errors";
import type { Tx } from "@/server/db/context";
import type { TenantContext } from "@/server/tenant/types";
import type { MemberStatusFilter } from "@/lib/validation/members";

export function todayFor(ctx: TenantContext): DateString {
  return localDate(new Date(), ctx.gym.timezone);
}

/**
 * Prisma filters mirroring domain/membership.ts membershipStateOn(), so list filters and
 * the status shown on each row always agree.
 */
export function membershipFilters(today: DateString) {
  const d = fromDateString(today);
  const coversToday = { startDate: { lte: d }, endDate: { gte: d } };
  const frozenToday = { freezes: { some: coversToday } };
  const current: Prisma.MembershipWhereInput = { ...coversToday, status: { in: ["ACTIVE", "FROZEN"] } };
  const activeNow: Prisma.MembershipWhereInput = { ...current, freezes: { none: coversToday } };
  const frozenNow: Prisma.MembershipWhereInput = { ...current, ...frozenToday };
  const upcoming: Prisma.MembershipWhereInput = { startDate: { gt: d }, status: { in: ["ACTIVE", "FROZEN"] } };
  return { activeNow, frozenNow, upcoming, current };
}

export function statusWhere(status: MemberStatusFilter | undefined, today: DateString): Prisma.MemberWhereInput {
  const f = membershipFilters(today);
  switch (status) {
    case "active":
      return { memberships: { some: { OR: [f.activeNow, f.upcoming] } } };
    case "frozen":
      return { AND: [{ memberships: { some: f.frozenNow } }, { memberships: { none: { OR: [f.activeNow, f.upcoming] } } }] };
    case "expired":
      return { AND: [{ memberships: { some: {} } }, { memberships: { none: { OR: [f.current, f.upcoming] } } }] };
    case "none":
      return { memberships: { none: {} } };
    default:
      return {};
  }
}

/** Trainers (no members.viewAll) only ever see members assigned to them. */
export function visibilityWhere(ctx: TenantContext): Prisma.MemberWhereInput {
  if (ctx.permissions.has("members.viewAll")) return { deletedAt: null };
  return { deletedAt: null, trainers: { some: { trainerId: ctx.staffId ?? "__none__" } } };
}

export async function assertMemberVisible(tx: Tx, ctx: TenantContext, memberId: string) {
  const found = await tx.member.findFirst({ where: { id: memberId, ...visibilityWhere(ctx) }, select: { id: true } });
  if (!found) throw new NotFoundError("Member not found.");
}

export type EmergencyContact = { name: string | null; phone: string | null; relation: string | null };

export function memberCrypto(gymId: string, memberId: string) {
  const ctx = (field: string) => ({ gymId, model: "Member", field, recordId: memberId });
  return {
    enc: (field: "phone" | "address" | "dateOfBirth" | "healthNotes", value: string | null) => encryptOptional(value, ctx(field)),
    // Display decryption is fault-tolerant: an unreadable value shows as empty and is logged.
    dec: (field: "phone" | "address" | "dateOfBirth" | "healthNotes", value: string | null) => tryDecrypt(value, ctx(field)),
    encEmergency: (value: EmergencyContact | null) => (value && value.name ? encryptJson(value, ctx("emergencyContact")) : null),
    decEmergency: (value: string | null): EmergencyContact | null => {
      const json = tryDecrypt(value, ctx("emergencyContact"));
      return json ? (JSON.parse(json) as EmergencyContact) : null;
    },
  };
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return error instanceof Error && error.message.includes(constraint);
}
