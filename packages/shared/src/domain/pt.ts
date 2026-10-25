import { round1, seriesFor, type ProgressPoint } from "./progress";

/**
 * Personal training: goals, targets and how far a client has come. Shared by the web portal,
 * the API and the app, so "progress toward the goal" means the same thing everywhere.
 */

export const PT_GOALS = ["WEIGHT_LOSS", "MUSCLE_GAIN", "STRENGTH", "ENDURANCE", "GENERAL_FITNESS", "REHAB", "SPORT"] as const;
export type PtGoal = (typeof PT_GOALS)[number];

export const PT_GOAL_LABELS: Record<PtGoal, string> = {
  WEIGHT_LOSS: "Weight loss",
  MUSCLE_GAIN: "Muscle gain",
  STRENGTH: "Strength",
  ENDURANCE: "Endurance",
  GENERAL_FITNESS: "General fitness",
  REHAB: "Rehab and mobility",
  SPORT: "Sport-specific",
};

/** Targets are health data: stored encrypted as one JSON object on the assignment. */
export type PtTargets = {
  targetWeightKg?: number;
  targetBodyFatPct?: number;
  /** YYYY-MM-DD */
  targetDate?: string;
  note?: string;
};

export const PT_TARGET_LIMITS = {
  weightKg: { min: 20, max: 400 },
  bodyFatPct: { min: 2, max: 75 },
  noteMax: 500,
  endReasonMax: 200,
} as const;

/** Sessions are 15 minutes to 4 hours, booked up to 6 months ahead (as in validation/fitness). */
export const PT_SESSION_MINUTES = { min: 15, max: 240, default: 60 } as const;

export type TargetProgress = {
  metric: "weightKg" | "bodyFatPct";
  label: string;
  unit: string;
  start: number;
  current: number;
  target: number;
  /** 0–100: share of the distance from start to target already covered (never negative). */
  percent: number;
  /** Still to go, in the metric's unit (0 once reached). */
  remaining: number;
  reached: boolean;
};

/**
 * Progress toward each target the client has, from their measurements. "Start" is where they were
 * when training began: the latest measurement on or before that day, or else the first one after
 * it. "Current" is the latest. Works in either direction (losing or gaining).
 */
export function targetProgress(entries: readonly ProgressPoint[], targets: PtTargets | null, startedOn: string): TargetProgress[] {
  if (!targets) return [];
  const wanted = [
    { metric: "weightKg" as const, label: "Weight", unit: "kg", target: targets.targetWeightKg },
    { metric: "bodyFatPct" as const, label: "Body fat", unit: "%", target: targets.targetBodyFatPct },
  ];
  return wanted.flatMap((w) => {
    if (typeof w.target !== "number") return [];
    const series = seriesFor(entries, w.metric);
    if (series.length === 0) return [];
    const baseline = [...series].reverse().find((p) => p.date <= startedOn) ?? series[0];
    const start = baseline.value;
    const current = series[series.length - 1].value;
    const total = w.target - start;
    const done = current - start;
    const reached = total === 0 || (total < 0 ? current <= w.target : current >= w.target);
    const percent = reached ? 100 : Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    return [{ metric: w.metric, label: w.label, unit: w.unit, start, current, target: w.target, percent, remaining: reached ? 0 : round1(Math.abs(w.target - current)), reached }];
  });
}

/** Share of scheduled workout days completed, as a whole percent (null when nothing was planned). */
export function completionRate(completed: number, planned: number): number | null {
  if (planned <= 0) return null;
  return Math.min(100, Math.round((completed / planned) * 100));
}

/** No-show rate over closed sessions (completed + no-show), whole percent. */
export function noShowRate(completed: number, noShows: number): number | null {
  const closed = completed + noShows;
  return closed === 0 ? null : Math.round((noShows / closed) * 100);
}

// ─────────────────────────────── Inbox wording (inside the app, behind sign-in) ───────────────────────────────

export function ptAssignedMemberText(trainerName: string, goal: PtGoal | null) {
  return {
    title: "You have a personal trainer",
    body: goal ? `${trainerName} is now your personal trainer, working with you on ${PT_GOAL_LABELS[goal].toLowerCase()}.` : `${trainerName} is now your personal trainer.`,
  };
}

export function ptAssignedTrainerText(memberName: string, goal: PtGoal | null) {
  return {
    title: "New PT client",
    body: goal ? `${memberName} is now your client. Goal: ${PT_GOAL_LABELS[goal].toLowerCase()}.` : `${memberName} is now your client.`,
  };
}

export function ptEndedMemberText(trainerName: string) {
  return { title: "Personal training ended", body: `${trainerName} is no longer your personal trainer. Ask the front desk if you'd like a new one.` };
}

export function ptEndedTrainerText(memberName: string) {
  return { title: "PT client removed", body: `${memberName} is no longer your client.` };
}

export function ptSessionBookedText(withName: string, when: string) {
  return { title: "PT session booked", body: `Personal training with ${withName} on ${when}.` };
}

export function ptSessionCancelledText(withName: string, when: string) {
  return { title: "PT session cancelled", body: `Your personal training with ${withName} on ${when} was cancelled.` };
}

// ─────────────────────────────── Packages and credits (part 2) ───────────────────────────────

/** Members get a reminder this long before a PT session (the trainer too). */
export const PT_REMINDER_MINUTES = 120;
/** Warn about a package ending within this many days while credits are left. */
export const PT_PACKAGE_EXPIRY_WARNING_DAYS = 7;
/** Credits-left levels that trigger an alert (once each per package). */
export const PT_LOW_CREDIT_LEVELS = [1, 0] as const;

export type PackageState = "upcoming" | "active" | "used_up" | "expired" | "cancelled";

export type CreditPackage = { sessionsTotal: number; startsOn: string; expiresOn: string; cancelledAt: Date | string | null };

/**
 * Where a sold package stands. `used` counts the sessions holding one of its credits: booked,
 * done or missed (a cancelled session gives its credit back).
 */
export function packageState(p: CreditPackage, used: number, today: string): { state: PackageState; remaining: number } {
  const remaining = Math.max(0, p.sessionsTotal - used);
  if (p.cancelledAt) return { state: "cancelled", remaining: 0 };
  if (today > p.expiresOn) return { state: "expired", remaining: 0 };
  if (remaining === 0) return { state: "used_up", remaining };
  return { state: today < p.startsOn ? "upcoming" : "active", remaining };
}

export const PACKAGE_STATE_LABELS: Record<PackageState, string> = {
  upcoming: "Starts later",
  active: "Active",
  used_up: "Used up",
  expired: "Expired",
  cancelled: "Cancelled",
};

/**
 * Which package a session on `day` should use: a live one that covers that day, is for this
 * trainer (or any trainer), with a credit left; the one ending soonest first, so credits don't
 * go to waste.
 */
export function pickPackage<T extends CreditPackage & { id: string; trainerId: string | null }>(packages: readonly T[], used: ReadonlyMap<string, number>, day: string, trainerId: string): T | null {
  return (
    [...packages]
      .filter((p) => !p.cancelledAt && p.startsOn <= day && day <= p.expiresOn && (p.trainerId === null || p.trainerId === trainerId))
      .filter((p) => p.sessionsTotal - (used.get(p.id) ?? 0) > 0)
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.startsOn.localeCompare(b.startsOn))[0] ?? null
  );
}

export function ptReminderMemberText(trainerName: string, time: string) {
  return { title: "PT session soon", body: `Personal training with ${trainerName} at ${time}.` };
}

export function ptReminderTrainerText(memberName: string, time: string) {
  return { title: "PT session soon", body: `${memberName} at ${time}.` };
}

const sessionsLeft = (n: number) => (n === 0 ? "no PT sessions left" : n === 1 ? "1 PT session left" : `${n} PT sessions left`);

export function ptCreditsLowMemberText(packageName: string, remaining: number) {
  return {
    title: remaining === 0 ? "PT package used up" : "PT package almost used",
    body: `You have ${sessionsLeft(remaining)} on ${packageName}. Ask at the front desk to renew.`,
  };
}

export function ptCreditsLowTrainerText(memberName: string, remaining: number) {
  return { title: "Client's PT package low", body: `${memberName} has ${sessionsLeft(remaining)}. A good time to talk about renewing.` };
}

export function ptPackageExpiringText(packageName: string, remaining: number, endsOn: string) {
  return { title: "PT sessions expiring", body: `${sessionsLeft(remaining)[0].toUpperCase()}${sessionsLeft(remaining).slice(1)} on ${packageName}, which ends on ${endsOn}. Book them before they expire.` };
}
