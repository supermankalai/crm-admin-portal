import "server-only";
import { DUPLICATE_WINDOW_MS, evaluateCheckIn, parseCheckInQuery } from "@/domain/checkin";
import { dayBounds, fromDateString, toDateString } from "@/domain/dates";
import { formatMemberNumber } from "@/domain/member-search";
import type { MembershipRecord } from "@/domain/membership";
import { recordAudit } from "@/server/audit/tenant-audit";
import type { Tx } from "@/server/db/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import { todayFor, visibilityWhere } from "./members/shared";

async function membershipRecords(tx: Tx, memberId: string): Promise<MembershipRecord[]> {
  const rows = await tx.membership.findMany({
    where: { memberId },
    orderBy: { endDate: "desc" },
    take: 10,
    select: { id: true, status: true, startDate: true, endDate: true, cancelledAt: true, freezes: { select: { startDate: true, endDate: true } } },
  });
  return rows.map((m) => ({
    ...m,
    startDate: toDateString(m.startDate),
    endDate: toDateString(m.endDate),
    freezes: m.freezes.map((f) => ({ startDate: toDateString(f.startDate), endDate: toDateString(f.endDate) })),
  }));
}

async function overdueCount(tx: Tx, memberId: string, today: string) {
  return tx.invoice.count({ where: { memberId, status: "OPEN", deletedAt: null, dueDate: { lt: fromDateString(today) } } });
}

export function listCheckInLocations(ctx: TenantContext) {
  assertCan(ctx, "checkin.perform");
  return inTenant(ctx, (tx) => tx.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }));
}

/**
 * Find members from the front-desk box: a scanned QR code, a member number, or a name.
 * Each candidate carries a preview of the check-in decision.
 */
export async function lookupForCheckIn(ctx: TenantContext, raw: string) {
  assertCan(ctx, "checkin.perform");
  const query = parseCheckInQuery(raw);
  if (query.kind === "none") return { method: "NAME_SEARCH" as const, candidates: [] };
  const today = todayFor(ctx);
  return inTenant(ctx, async (tx) => {
    const base = visibilityWhere(ctx);
    const where =
      query.kind === "code"
        ? { ...base, checkInCode: query.code }
        : query.kind === "memberNumber"
          ? { ...base, memberNumber: query.value }
          : {
              ...base,
              AND: query.text
                .toLowerCase()
                .split(/\s+/)
                .slice(0, 3)
                .map((t) => ({ OR: [{ firstName: { contains: t, mode: "insensitive" as const } }, { lastName: { contains: t, mode: "insensitive" as const } }] })),
            };
    const members = await tx.member.findMany({ where, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 8, select: { id: true, firstName: true, lastName: true, memberNumber: true, photoFileId: true } });
    const candidates = [];
    for (const m of members) {
      const decision = evaluateCheckIn(await membershipRecords(tx, m.id), today);
      candidates.push({
        id: m.id,
        name: `${m.firstName} ${m.lastName}`,
        memberNumber: formatMemberNumber(m.memberNumber),
        photoFileId: m.photoFileId,
        decision,
        overdueInvoices: await overdueCount(tx, m.id, today),
      });
    }
    return { method: query.kind === "code" ? ("QR" as const) : query.kind === "memberNumber" ? ("MEMBER_ID" as const) : ("NAME_SEARCH" as const), candidates };
  });
}

/**
 * Check a member in. Every attempt is recorded (allowed or denied, with the reason). A second
 * scan within two minutes returns the earlier check-in instead of recording a duplicate.
 */
export async function checkInMember(
  ctx: TenantContext,
  input: { memberId: string; locationId: string; method: "NAME_SEARCH" | "MEMBER_ID" | "QR" },
  meta: RequestMeta
) {
  assertCan(ctx, "checkin.perform");
  const today = todayFor(ctx);
  return inTenant(ctx, async (tx) => {
    // Serialise check-ins for one member so double scans can't both be recorded.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkin:${input.memberId}`}))`; // returns void → $executeRaw
    const member = await tx.member.findFirst({ where: { id: input.memberId, ...visibilityWhere(ctx) }, select: { id: true, firstName: true, lastName: true } });
    if (!member) throw new NotFoundError("Member not found.");
    const location = await tx.location.findFirst({ where: { id: input.locationId, isActive: true }, select: { id: true, name: true } });
    if (!location) throw new ValidationError("Choose a valid location.");

    const decision = evaluateCheckIn(await membershipRecords(tx, member.id), today);
    const name = `${member.firstName} ${member.lastName}`;

    if (decision.result === "ALLOWED") {
      const recent = await tx.checkIn.findFirst({
        where: { memberId: member.id, result: "ALLOWED", checkedInAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
        orderBy: { checkedInAt: "desc" },
        select: { id: true, checkedInAt: true },
      });
      if (recent) return { ...decision, name, checkInId: recent.id, checkedInAt: recent.checkedInAt, duplicate: true, overdueInvoices: await overdueCount(tx, member.id, today) };
    }

    const checkIn = await tx.checkIn.create({
      data: { gymId: ctx.gym.id, memberId: member.id, locationId: location.id, method: input.method, result: decision.result, recordedById: ctx.staffId },
      select: { id: true, checkedInAt: true },
    });
    await recordAudit(tx, ctx, { action: "checkin.record", entityType: "CheckIn", entityId: checkIn.id, changes: { memberId: member.id, result: decision.result, method: input.method, location: location.name } }, meta);
    return { ...decision, name, checkInId: checkIn.id, checkedInAt: checkIn.checkedInAt, duplicate: false, overdueInvoices: await overdueCount(tx, member.id, today) };
  });
}

/** Today's check-in log (gym-local day), newest first. */
export async function todaysCheckIns(ctx: TenantContext, locationId?: string) {
  assertCan(ctx, "checkin.perform");
  const day = dayBounds(todayFor(ctx), ctx.gym.timezone);
  return inTenant(ctx, async (tx) => {
    const where = { checkedInAt: { gte: day.start, lt: day.end }, ...(locationId ? { locationId } : {}) };
    const allowed = await tx.checkIn.count({ where: { ...where, result: "ALLOWED" } });
    const denied = await tx.checkIn.count({ where: { ...where, result: { not: "ALLOWED" } } });
    const recent = await tx.checkIn.findMany({
      where,
      orderBy: { checkedInAt: "desc" },
      take: 25,
      select: { id: true, checkedInAt: true, result: true, method: true, location: { select: { name: true } }, member: { select: { id: true, firstName: true, lastName: true, memberNumber: true } } },
    });
    return { allowed, denied, recent };
  });
}
