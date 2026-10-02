/** Platform plan limits and feature flags. Enforced on the server (and limits again in the DB). */

export type LimitKind = "members" | "staff" | "locations";
export type FeatureKey = "reports" | "csvExport" | "classBookings";

export type PlanLimits = {
  name: string;
  maxMembers: number;
  maxStaff: number;
  maxLocations: number;
  features: Record<FeatureKey, boolean>;
};

export const LIMIT_LABELS: Record<LimitKind, { singular: string; plural: string }> = {
  members: { singular: "member", plural: "members" },
  staff: { singular: "staff account", plural: "staff accounts" },
  locations: { singular: "location", plural: "locations" },
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  reports: "Reports",
  csvExport: "CSV export",
  classBookings: "Class bookings",
};

export function limitFor(plan: PlanLimits, kind: LimitKind): number {
  return kind === "members" ? plan.maxMembers : kind === "staff" ? plan.maxStaff : plan.maxLocations;
}

export type LimitCheck = { allowed: boolean; used: number; limit: number; remaining: number };

/** Can `adding` more items be added on top of `used`? */
export function checkLimit(plan: PlanLimits, kind: LimitKind, used: number, adding = 1): LimitCheck {
  const limit = limitFor(plan, kind);
  return { allowed: used + adding <= limit, used, limit, remaining: Math.max(limit - used, 0) };
}

export function limitMessage(plan: PlanLimits, kind: LimitKind): string {
  const limit = limitFor(plan, kind);
  const label = limit === 1 ? LIMIT_LABELS[kind].singular : LIMIT_LABELS[kind].plural;
  return `Your ${plan.name} plan includes up to ${limit.toLocaleString()} ${label}, and you've reached it. Upgrade your plan to add more.`;
}

export function featureMessage(plan: PlanLimits, feature: FeatureKey): string {
  return `${FEATURE_LABELS[feature]} isn't included in your ${plan.name} plan. Upgrade your plan to use it.`;
}

/** Usage level for meters: "ok" under 80%, "near" from 80%, "full" at the limit. */
export function usageLevel(used: number, limit: number): "ok" | "near" | "full" {
  if (used >= limit) return "full";
  return used / limit >= 0.8 ? "near" : "ok";
}
