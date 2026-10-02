import type { DateString } from "./dates";
import { currentMembership, membershipStateOn, type MembershipRecord } from "./membership";

/**
 * Front-desk check-in rules. Every attempt is recorded — allowed or not — with the reason.
 */

export type CheckInResult = "ALLOWED" | "DENIED_EXPIRED" | "DENIED_FROZEN" | "DENIED_NO_MEMBERSHIP";

export type CheckInDecision = {
  result: CheckInResult;
  membershipId: string | null;
  message: string;
};

/** Repeated scans of the same member within this window count as one check-in. */
export const DUPLICATE_WINDOW_MS = 2 * 60_000;

export function evaluateCheckIn(memberships: MembershipRecord[], today: DateString): CheckInDecision {
  const active = currentMembership(memberships, today);
  if (active && membershipStateOn(active, today) === "active") {
    return { result: "ALLOWED", membershipId: active.id, message: "Checked in." };
  }
  if (active && membershipStateOn(active, today) === "frozen") {
    const freeze = active.freezes.find((f) => f.startDate <= today && f.endDate >= today);
    return { result: "DENIED_FROZEN", membershipId: active.id, message: `Membership is frozen${freeze ? ` until ${freeze.endDate}` : ""}.` };
  }
  if (memberships.some((m) => membershipStateOn(m, today) === "upcoming")) {
    const next = memberships.filter((m) => membershipStateOn(m, today) === "upcoming").sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    return { result: "DENIED_NO_MEMBERSHIP", membershipId: next.id, message: `Membership starts on ${next.startDate}.` };
  }
  if (memberships.length) {
    const last = [...memberships].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
    const cancelled = membershipStateOn(last, today) === "cancelled";
    return { result: "DENIED_EXPIRED", membershipId: last.id, message: cancelled ? "Membership was cancelled." : `Membership expired on ${last.endDate}.` };
  }
  return { result: "DENIED_NO_MEMBERSHIP", membershipId: null, message: "No membership on file." };
}

/** What the scanner / search box contains: a QR check-in code, a member number, or a name. */
export type CheckInQuery = { kind: "code"; code: string } | { kind: "memberNumber"; value: number } | { kind: "name"; text: string } | { kind: "none" };

export function parseCheckInQuery(raw: string): CheckInQuery {
  const q = raw.trim();
  if (!q) return { kind: "none" };
  const numbered = /^(?:m-?|#)?0*(\d{1,7})$/i.exec(q);
  if (numbered) return { kind: "memberNumber", value: Number(numbered[1]) };
  // QR codes encode "FITCRM:<code>"; a handheld scanner may type just the 10-character code.
  // A bare code must mix letters and digits, so a 10-letter name is never mistaken for one.
  const upper = q.toUpperCase();
  const prefixed = /^FITCRM:([A-Z0-9]{10})$/.exec(upper);
  if (prefixed) return { kind: "code", code: prefixed[1] };
  if (/^[A-Z0-9]{10}$/.test(upper) && /\d/.test(upper) && /[A-Z]/.test(upper)) return { kind: "code", code: upper };
  return { kind: "name", text: q.slice(0, 80) };
}
