import { addDays, type DateString } from "./dates";
import { membershipStateOn, type MembershipRecord } from "./membership";

/**
 * Class scheduling and booking rules. Pure functions — persistence locks the session row so
 * these decisions are made one booking at a time (no overbooking under concurrency).
 */

export class ClassRuleError extends Error {}

/** Monday of the week containing `date` (gym-local calendar). */
export function weekStart(date: DateString): DateString {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow);
}

export function weekDays(monday: DateString): DateString[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** BOOKED while there is a free spot, otherwise WAITLISTED at the end of the queue. */
export function bookingPlacement(capacity: number, bookedCount: number, waitlistCount: number) {
  if (bookedCount < capacity) return { status: "BOOKED" as const, waitlistPosition: null };
  return { status: "WAITLISTED" as const, waitlistPosition: waitlistCount + 1 };
}

export type BookableMembership = MembershipRecord & { classCreditsRemaining: number | null };

/**
 * Which membership (if any) lets the member book a class on `classDate`. Time-based plans give
 * unlimited bookings; class packs need a remaining credit (spent when the spot is confirmed).
 */
export function membershipForBooking(memberships: BookableMembership[], classDate: DateString) {
  const usable = memberships.filter((m) => membershipStateOn(m, classDate) === "active");
  if (!usable.length) {
    const frozen = memberships.some((m) => membershipStateOn(m, classDate) === "frozen");
    throw new ClassRuleError(frozen ? "The member's membership is frozen on that date." : "The member needs an active membership on the class date to book.");
  }
  const unlimited = usable.find((m) => m.classCreditsRemaining === null);
  if (unlimited) return { membershipId: unlimited.id, usesCredit: false };
  const pack = usable.find((m) => (m.classCreditsRemaining ?? 0) > 0);
  if (!pack) throw new ClassRuleError("The member's class pack has no classes left.");
  return { membershipId: pack.id, usesCredit: true };
}

/** A cancelled booking gives the class credit back only if cancelled before the class starts. */
export function refundsCredit(sessionStartsAt: Date, now: Date = new Date()): boolean {
  return now < sessionStartsAt;
}

export function assertBookable(session: { status: string; startsAt: Date; endsAt: Date }, now: Date = new Date()) {
  if (session.status === "CANCELLED") throw new ClassRuleError("This class has been cancelled.");
  if (session.endsAt <= now) throw new ClassRuleError("This class has already finished.");
}

/** Attendance can be marked from 30 minutes before start until 24 hours after the end. */
export function canMarkAttendance(session: { startsAt: Date; endsAt: Date }, now: Date = new Date()): boolean {
  return now.getTime() >= session.startsAt.getTime() - 30 * 60_000 && now.getTime() <= session.endsAt.getTime() + 24 * 3_600_000;
}
