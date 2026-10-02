"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { GymStatusBadge, SubscriptionStatusBadge } from "@/components/status-badges";

export type GymRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: Date;
  members: number;
  staff: number;
  checkIns30d: number;
  subscription: { status: string; currentPeriodEnd: Date; trialEndsAt: Date | null; plan: { code: string; name: string; maxMembers: number } } | null;
};

const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

const columns: ColumnDef<GymRow, unknown>[] = [
  {
    header: "Gym",
    cell: ({ row }) => (
      <Link href={`/admin/gyms/${row.original.id}`} className="group block">
        <span className="font-medium group-hover:underline">{row.original.name}</span>
        <span className="block text-xs text-muted-foreground">/g/{row.original.slug}</span>
      </Link>
    ),
  },
  { header: "Status", cell: ({ row }) => <GymStatusBadge status={row.original.status} /> },
  {
    header: "Plan",
    cell: ({ row }) =>
      row.original.subscription ? (
        <div className="flex items-center gap-2">
          {row.original.subscription.plan.name}
          <SubscriptionStatusBadge status={row.original.subscription.status} />
        </div>
      ) : (
        "—"
      ),
  },
  {
    header: "Period ends",
    cell: ({ row }) => (row.original.subscription ? date.format(row.original.subscription.currentPeriodEnd) : "—"),
  },
  {
    header: "Members",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.members.toLocaleString("en-IN")}
        {row.original.subscription && <span className="text-muted-foreground"> / {row.original.subscription.plan.maxMembers.toLocaleString("en-IN")}</span>}
      </span>
    ),
  },
  { header: "Staff", cell: ({ row }) => <span className="tabular-nums">{row.original.staff}</span> },
  { header: "Check-ins (30d)", cell: ({ row }) => <span className="tabular-nums">{row.original.checkIns30d.toLocaleString("en-IN")}</span> },
  { header: "Created", cell: ({ row }) => date.format(row.original.createdAt) },
];

export function GymsTable({ rows }: { rows: GymRow[] }) {
  return <DataTable columns={columns} data={rows} empty="No gyms match these filters." caption="Gyms" />;
}
