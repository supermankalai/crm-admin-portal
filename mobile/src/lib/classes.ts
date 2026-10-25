import type { ResponseOf } from "@fitcrm/shared/api/contract";

/** Display rules for a member's view of a class. */

export type MemberClass = ResponseOf<"memberClasses">["classes"][number];

export function classBadge(c: MemberClass): { label: string; tone: "green" | "amber" | "red" | "sky" | "zinc" } | null {
  if (c.status === "CANCELLED") return { label: "Cancelled", tone: "zinc" };
  if (c.my?.status === "BOOKED") return { label: "Booked", tone: "green" };
  if (c.my?.status === "WAITLISTED") return { label: `Waitlist #${c.my.waitlistPosition}`, tone: "amber" };
  if (c.my?.status === "ATTENDED") return { label: "Attended", tone: "green" };
  if (c.spotsLeft === 0) return { label: c.waitlisted ? `Full · ${c.waitlisted} waiting` : "Full", tone: "red" };
  return null;
}

export function spotsText(c: MemberClass) {
  return c.spotsLeft === 0 ? "No spots left" : `${c.spotsLeft} of ${c.capacity} spot${c.capacity === 1 ? "" : "s"} left`;
}
