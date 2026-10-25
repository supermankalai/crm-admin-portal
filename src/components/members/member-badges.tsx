import { Badge } from "@/components/ui/badge";
import type { MemberStatus, MembershipState } from "@/domain/membership";

const MEMBER: Record<MemberStatus, { label: string; variant: "success" | "info" | "warning" | "secondary" }> = {
  active: { label: "Active", variant: "success" },
  frozen: { label: "Frozen", variant: "info" },
  expired: { label: "Expired", variant: "warning" },
  none: { label: "No membership", variant: "secondary" },
};

const MEMBERSHIP: Record<MembershipState, { label: string; variant: "success" | "info" | "warning" | "secondary" | "danger" }> = {
  active: { label: "Active", variant: "success" },
  upcoming: { label: "Starts later", variant: "secondary" },
  frozen: { label: "Frozen", variant: "info" },
  expired: { label: "Expired", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "danger" },
};

export function MemberStatusBadge({ status }: { status: MemberStatus }) {
  return <Badge variant={MEMBER[status].variant}>{MEMBER[status].label}</Badge>;
}

export function MembershipStateBadge({ state, cancelling }: { state: MembershipState; cancelling?: boolean }) {
  if (state === "active" && cancelling) return <Badge variant="warning">Cancelling</Badge>;
  return <Badge variant={MEMBERSHIP[state].variant}>{MEMBERSHIP[state].label}</Badge>;
}
