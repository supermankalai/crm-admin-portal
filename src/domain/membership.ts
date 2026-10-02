import { addDays, diffDays, type DateString } from "./dates";

/**
 * Membership rules: what state a membership is in on a given gym-local day, and the freeze
 * and cancellation rules that come from its plan. Pure functions — no I/O.
 */

export type MembershipRecord = {
  id: string;
  status: "ACTIVE" | "FROZEN" | "CANCELLED" | "EXPIRED";
  startDate: DateString;
  endDate: DateString;
  cancelledAt: Date | null;
  freezes: { startDate: DateString; endDate: DateString }[];
};

export type MembershipState = "upcoming" | "active" | "frozen" | "expired" | "cancelled";

/**
 * - Cancelled immediately (status CANCELLED) → cancelled.
 * - Past its end date → expired, or cancelled if it was cancelled with notice (no job needed).
 * - Cancelled with notice → still usable until its shortened end date ("active", cancelling).
 * - Frozen → frozen only while a freeze period covers today; afterwards it is active again.
 */
export function membershipStateOn(m: MembershipRecord, today: DateString): MembershipState {
  if (m.status === "CANCELLED") return "cancelled";
  if (m.endDate < today) return m.cancelledAt ? "cancelled" : "expired";
  if (m.startDate > today) return "upcoming";
  if (m.status === "EXPIRED") return "expired";
  if (m.freezes.some((f) => f.startDate <= today && f.endDate >= today)) return "frozen";
  return "active";
}

export type MemberStatus = "active" | "frozen" | "expired" | "none";

/** A member's headline status from all their memberships (active beats frozen beats expired). */
export function memberStatusOn(memberships: MembershipRecord[], today: DateString): MemberStatus {
  if (!memberships.length) return "none";
  const states = memberships.map((m) => membershipStateOn(m, today));
  if (states.includes("active")) return "active";
  if (states.includes("frozen")) return "frozen";
  return states.includes("upcoming") ? "active" : "expired";
}

/** The membership that governs access today (active first, then frozen), if any. */
export function currentMembership<T extends MembershipRecord>(memberships: T[], today: DateString): T | null {
  return (
    memberships.find((m) => membershipStateOn(m, today) === "active") ??
    memberships.find((m) => membershipStateOn(m, today) === "frozen") ??
    null
  );
}

/** Days left including today (0 once ended). */
export function daysRemaining(m: Pick<MembershipRecord, "endDate">, today: DateString): number {
  return Math.max(diffDays(today, m.endDate) + 1, 0);
}

// ─────────────────────────────── Freezing ───────────────────────────────

export type FreezePolicy = { allowFreeze: boolean; maxFreezeDays: number };

export class MembershipRuleError extends Error {}

export function freezeDaysUsed(m: Pick<MembershipRecord, "freezes">): number {
  return m.freezes.reduce((sum, f) => sum + diffDays(f.startDate, f.endDate) + 1, 0);
}

/**
 * Freeze from today for `days` days. The membership end date moves out by the same number of
 * days, so the member does not lose paid time.
 */
export function planFreeze(m: MembershipRecord, policy: FreezePolicy, today: DateString, days: number) {
  if (!policy.allowFreeze) throw new MembershipRuleError("This membership plan does not allow freezing.");
  if (!Number.isInteger(days) || days < 1) throw new MembershipRuleError("Freeze for at least one day.");
  const state = membershipStateOn(m, today);
  if (state === "frozen") throw new MembershipRuleError("This membership is already frozen.");
  if (state !== "active") throw new MembershipRuleError("Only an active membership can be frozen.");
  if (m.cancelledAt) throw new MembershipRuleError("A membership that is being cancelled cannot be frozen.");
  const remaining = policy.maxFreezeDays - freezeDaysUsed(m);
  if (days > remaining) {
    throw new MembershipRuleError(
      remaining > 0 ? `Only ${remaining} freeze day${remaining === 1 ? "" : "s"} left on this membership.` : "No freeze days left on this membership."
    );
  }
  return { freezeStart: today, freezeEnd: addDays(today, days - 1), newEndDate: addDays(m.endDate, days) };
}

/** End a freeze early (today counts as active again); unused freeze days are given back. */
export function planUnfreeze(m: MembershipRecord, today: DateString) {
  const freeze = m.freezes.find((f) => f.startDate <= today && f.endDate >= today);
  if (!freeze) throw new MembershipRuleError("This membership is not frozen today.");
  const unused = diffDays(today, freeze.endDate) + 1;
  return {
    freeze,
    newFreezeEnd: addDays(today, -1) < freeze.startDate ? null : addDays(today, -1), // null → remove the freeze entirely
    newEndDate: addDays(m.endDate, -unused),
  };
}

// ───────────────────────────── Cancellation ─────────────────────────────

export type CancellationPolicy = { cancellationNoticeDays: number; cancellationFeeMinor: number };

/**
 * Cancel according to the plan's notice period:
 *  - no notice (or the membership has not started yet) → cancelled immediately;
 *  - otherwise access continues until today + notice days, never beyond the paid end date.
 * The cancellation fee (if any) is charged separately as an invoice.
 */
export function planCancellation(m: MembershipRecord, policy: CancellationPolicy, today: DateString) {
  if (m.cancelledAt || m.status === "CANCELLED") throw new MembershipRuleError("This membership is already cancelled.");
  const state = membershipStateOn(m, today);
  if (state === "expired") throw new MembershipRuleError("This membership has already ended.");
  if (state === "frozen") throw new MembershipRuleError("Unfreeze the membership before cancelling it.");

  if (state === "upcoming" || policy.cancellationNoticeDays <= 0) {
    // Keep endDate >= startDate (DB constraint) while ending access now.
    const effectiveEnd = state === "upcoming" ? m.startDate : today < m.endDate ? today : m.endDate;
    return { endsImmediately: true, effectiveEnd, feeMinor: policy.cancellationFeeMinor };
  }
  const noticeEnd = addDays(today, policy.cancellationNoticeDays);
  return { endsImmediately: false, effectiveEnd: noticeEnd < m.endDate ? noticeEnd : m.endDate, feeMinor: policy.cancellationFeeMinor };
}
