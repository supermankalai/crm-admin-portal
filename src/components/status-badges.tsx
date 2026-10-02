import { Badge } from "@/components/ui/badge";

const GYM: Record<string, { label: string; variant: "success" | "info" | "warning" | "danger" | "secondary" }> = {
  ACTIVE: { label: "Active", variant: "success" },
  TRIAL: { label: "Trial", variant: "info" },
  SUSPENDED: { label: "Suspended", variant: "warning" },
  CANCELLED: { label: "Cancelled", variant: "danger" },
};

const SUBSCRIPTION: Record<string, { label: string; variant: "success" | "info" | "warning" | "danger" | "secondary" }> = {
  ACTIVE: { label: "Active", variant: "success" },
  TRIALING: { label: "Trialing", variant: "info" },
  PAST_DUE: { label: "Past due", variant: "warning" },
  EXPIRED: { label: "Expired", variant: "warning" },
  CANCELLED: { label: "Cancelled", variant: "danger" },
};

export function GymStatusBadge({ status }: { status: string }) {
  const s = GYM[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function SubscriptionStatusBadge({ status }: { status: string }) {
  const s = SUBSCRIPTION[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
