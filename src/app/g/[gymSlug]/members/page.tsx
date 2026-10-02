import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { MEMBER_STATUS_FILTERS, type MemberStatusFilter } from "@/lib/validation/members";
import { listMembers, MEMBER_SORTS, type MemberSort } from "@/server/services/members/list";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { MembersTable } from "./members-table";

export const metadata: Metadata = { title: "Members" };

type Search = { q?: string; status?: string; sort?: string; page?: string };

const STATUS_LABELS: Record<MemberStatusFilter, string> = { active: "Active", frozen: "Frozen", expired: "Expired", none: "No membership" };

export default async function MembersPage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<Search> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "members.view")) return <AccessDenied what="members" />;
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const status = (MEMBER_STATUS_FILTERS as readonly string[]).includes(sp.status ?? "") ? (sp.status as MemberStatusFilter) : undefined;
  const sort = sp.sort && sp.sort in MEMBER_SORTS ? (sp.sort as MemberSort) : undefined;
  const result = await listMembers(ctx, { q, status, sort, page: Number(sp.page) || 1 });
  const ownOnly = !hasPermission(ctx, "members.viewAll");
  const canCreate = hasPermission(ctx, "members.create") && ctx.access.writable && !ctx.supportSessionId;
  const base = `/g/${ctx.gym.slug}/members`;

  return (
    <>
      <PageHeader
        title={ownOnly ? "My clients" : "Members"}
        description={ownOnly ? "Members assigned to you as their trainer." : "Search by name, member number (M-000123), email or full phone number."}
        actions={
          canCreate && (
            <Button asChild>
              <Link href={`${base}/new`}>
                <Plus aria-hidden /> Add member
              </Link>
            </Button>
          )
        }
      />
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap items-end gap-2 border-b p-4" role="search">
          <div className="relative w-full md:w-80">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Name, M-000123, email or phone…" className="pl-9" aria-label="Search members" />
          </div>
          <NativeSelect name="status" defaultValue={status ?? ""} className="w-full sm:w-44" aria-label="Filter by membership status">
            <option value="">All statuses</option>
            {MEMBER_STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="sort" defaultValue={sort ?? "recent"} className="w-full sm:w-44" aria-label="Sort members">
            {(Object.entries(MEMBER_SORTS) as [MemberSort, string][]).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {(q || status || sort) && (
            <Button asChild variant="ghost">
              <Link href={base}>Clear</Link>
            </Button>
          )}
        </form>
        {result.total === 0 && !q && !status ? (
          <EmptyState
            icon={<Users />}
            title={ownOnly ? "No clients assigned to you yet" : "No members yet"}
            description={ownOnly ? "A manager can assign members to you." : "Add your first member to get started."}
            action={
              canCreate && (
                <Button asChild>
                  <Link href={`${base}/new`}>Add member</Link>
                </Button>
              )
            }
          />
        ) : (
          <MembersTable rows={result.rows} gymSlug={ctx.gym.slug} timeZone={ctx.gym.timezone} />
        )}
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} noun={result.total === 1 ? "member" : "members"} basePath={base} params={{ q, status, sort }} />
      </Card>
    </>
  );
}
