import Link from "next/link";
import { LinkTabs } from "@/components/link-tabs";
import { Badge } from "@/components/ui/badge";
import { formatInvoiceNumber } from "@/domain/billing";
import { formatDate } from "@/domain/dates";
import { PACKAGE_STATE_LABELS, PT_GOAL_LABELS, type PackageState, type PtGoal } from "@/domain/pt";

/** Pieces shared by the PT module's pages (server components; no client state). */

export function PtTabs({ slug, active }: { slug: string; active: "overview" | "clients" | "sessions" | "packages" }) {
  const base = `/g/${slug}/pt`;
  return (
    <div className="mb-4">
      <LinkTabs
        label="Personal training"
        active={active}
        tabs={[
          { key: "overview", label: "Overview", href: base },
          { key: "clients", label: "Clients", href: `${base}/clients` },
          { key: "sessions", label: "Sessions", href: `${base}/sessions` },
          { key: "packages", label: "Packages", href: `${base}/packages` },
        ]}
      />
    </div>
  );
}

export function GoalBadge({ goal }: { goal: PtGoal | null }) {
  if (!goal) return <span className="text-xs text-muted-foreground">No goal set</span>;
  return <Badge variant="info">{PT_GOAL_LABELS[goal]}</Badge>;
}

export const SESSION_STATUS: Record<"SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW", { label: string; variant: "info" | "success" | "secondary" | "warning" }> = {
  SCHEDULED: { label: "Booked", variant: "info" },
  COMPLETED: { label: "Done", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
  NO_SHOW: { label: "No-show", variant: "warning" },
};

export function SessionStatusBadge({ status }: { status: keyof typeof SESSION_STATUS }) {
  const s = SESSION_STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

const PACKAGE_STATE_VARIANT: Record<PackageState, "success" | "info" | "secondary" | "warning" | "danger"> = {
  active: "success",
  upcoming: "info",
  used_up: "secondary",
  expired: "warning",
  cancelled: "danger",
};

export type MemberPackage = {
  id: string;
  name: string;
  sessionsTotal: number;
  used: number;
  remaining: number;
  state: PackageState;
  startsOn: string;
  expiresOn: string;
  trainer: { id: string; name: string } | null;
  invoice: { id: string; number: number; status: string };
};

/** A member's PT packages: credits left, dates, and the invoice (linked for those who see payments). */
export function MemberPackagesList({ packages, slug, showInvoices }: { packages: MemberPackage[]; slug: string; showInvoices: boolean }) {
  if (packages.length === 0) return <p className="text-sm text-muted-foreground">No PT packages yet.</p>;
  return (
    <ul className="divide-y text-sm">
      {packages.map((p) => (
        <li key={p.id} className="grid gap-1 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{p.name}</span>
            <Badge variant={PACKAGE_STATE_VARIANT[p.state]}>{PACKAGE_STATE_LABELS[p.state]}</Badge>
          </div>
          {(p.state === "active" || p.state === "upcoming" || p.state === "used_up") && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={p.used} aria-valuemin={0} aria-valuemax={p.sessionsTotal} aria-label={`${p.name}: ${p.used} of ${p.sessionsTotal} sessions used or booked`}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (p.used / p.sessionsTotal) * 100)}%` }} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">
              {p.remaining} of {p.sessionsTotal}
            </span>{" "}
            left · {formatDate(p.startsOn)} – {formatDate(p.expiresOn)}
            {p.trainer ? ` · with ${p.trainer.name}` : " · any trainer"}
            {" · "}
            {showInvoices ? (
              <Link href={`/g/${slug}/invoices/${p.invoice.id}`} className="text-primary underline-offset-4 hover:underline">
                {formatInvoiceNumber(p.invoice.number)}
              </Link>
            ) : (
              formatInvoiceNumber(p.invoice.number)
            )}
            {p.invoice.status === "OPEN" && " (unpaid)"}
          </p>
        </li>
      ))}
    </ul>
  );
}
