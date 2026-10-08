import type { Permission } from "@fitcrm/shared/domain/permissions";
import type { CheckInResult, MemberStatus, StaffClass } from "./staff-queries";

/** Display rules for the staff screens, kept out of the components so they can be tested. */

export type Outcome = { allowed: boolean; title: string; message: string; name: string | null; note: string | null };

/** The big green / red check-in result. Always says the result in words, never colour alone. */
export function checkInOutcome(r: Pick<CheckInResult, "result" | "message" | "name" | "duplicate" | "overdueInvoices">): Outcome {
  const allowed = r.result === "ALLOWED";
  const notes: string[] = [];
  if (r.duplicate) notes.push("Already checked in a moment ago — not counted twice.");
  if (r.overdueInvoices > 0) notes.push(`${r.overdueInvoices} overdue ${r.overdueInvoices === 1 ? "invoice" : "invoices"} — please ask them to pay.`);
  return { allowed, title: allowed ? "Allowed in" : "Not allowed", message: r.message, name: r.name, note: notes.length ? notes.join(" ") : null };
}

/** A failed scan or search (expired, used or foreign code; nobody found). */
export function failedOutcome(message: string): Outcome {
  return { allowed: false, title: "Not allowed", message, name: null, note: null };
}

/**
 * The camera reports the same code many times a second. Handle a code once, and ignore it again
 * for a few seconds so one member in front of the camera isn't scanned twice.
 */
export function createScanGate(windowMs = 4000, now: () => number = Date.now) {
  let busy = false;
  let last: { data: string; at: number } | null = null;
  return {
    /** True when this scan should be handled; marks the gate busy until `release()`. */
    accept(data: string) {
      if (busy) return false;
      if (last && last.data === data && now() - last.at < windowMs) return false;
      busy = true;
      last = { data, at: now() };
      return true;
    },
    release() {
      busy = false;
      if (last) last = { ...last, at: now() };
    },
  };
}

export const MEMBER_STATUS: Record<MemberStatus, { label: string; tone: "green" | "sky" | "red" | "zinc" }> = {
  active: { label: "Active", tone: "green" },
  frozen: { label: "Frozen", tone: "sky" },
  expired: { label: "Expired", tone: "red" },
  none: { label: "No membership", tone: "zinc" },
};

export function bookingText(c: Pick<StaffClass, "booked" | "capacity" | "waitlisted">) {
  return `${c.booked}/${c.capacity} booked${c.waitlisted ? ` · ${c.waitlisted} waiting` : ""}`;
}

export function can(permissions: readonly string[] | undefined, permission: Permission) {
  return !!permissions?.includes(permission);
}

/** Major-unit text for an amount in minor units ("1180.5"), for prefilling payment fields. */
export function minorToInput(minor: number) {
  const major = minor / 100;
  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}
