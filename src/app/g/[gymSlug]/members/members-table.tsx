"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { MemberStatusBadge } from "@/components/members/member-badges";
import { MemberAvatar } from "@/components/members/member-avatar";
import { formatDate } from "@/domain/dates";
import { formatMemberNumber } from "@/domain/member-search";
import type { MemberStatus } from "@/domain/membership";

export type MemberRow = {
  id: string;
  memberNumber: number;
  name: string;
  email: string | null;
  phone: string | null;
  photoFileId: string | null;
  status: MemberStatus;
  planName: string | null;
  endDate: string | null;
  cancelling: boolean;
  lastVisit: Date | null;
};

export function MembersTable({ rows, gymSlug, timeZone }: { rows: MemberRow[]; gymSlug: string; timeZone: string }) {
  const columns = useMemo<ColumnDef<MemberRow, unknown>[]>(
    () => [
      {
        header: "Member",
        cell: ({ row }) => (
          <Link href={`/g/${gymSlug}/members/${row.original.id}`} className="group flex items-center gap-3">
            <MemberAvatar name={row.original.name} gymSlug={gymSlug} photoFileId={row.original.photoFileId} size="sm" />
            <span>
              <span className="block font-medium group-hover:underline">{row.original.name}</span>
              <span className="block font-mono text-xs text-muted-foreground">{formatMemberNumber(row.original.memberNumber)}</span>
            </span>
          </Link>
        ),
      },
      {
        header: "Contact",
        cell: ({ row }) => (
          <span className="text-xs">
            <span className="block">{row.original.phone ?? "—"}</span>
            <span className="block text-muted-foreground">{row.original.email ?? ""}</span>
          </span>
        ),
      },
      { header: "Status", cell: ({ row }) => <MemberStatusBadge status={row.original.status} /> },
      {
        header: "Membership",
        cell: ({ row }) =>
          row.original.planName ? (
            <span className="text-xs">
              <span className="block">{row.original.planName}</span>
              <span className="block text-muted-foreground">
                {row.original.status === "expired" ? "Ended" : row.original.cancelling ? "Cancelling, ends" : "Until"} {row.original.endDate ? formatDate(row.original.endDate) : ""}
              </span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        header: "Last visit",
        cell: ({ row }) => <span className="text-xs">{row.original.lastVisit ? formatDate(row.original.lastVisit, timeZone) : "Never"}</span>,
      },
    ],
    [gymSlug, timeZone]
  );
  return <DataTable columns={columns} data={rows} empty="No members match your search." caption="Members" />;
}
