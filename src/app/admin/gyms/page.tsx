import type { Metadata } from "next";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requirePlatformAdmin } from "@/server/platform/guard";
import { listGyms } from "@/server/platform/services";
import { GymsTable } from "./gyms-table";

export const metadata: Metadata = { title: "Gyms" };

type Search = { q?: string; status?: string; page?: string };

export default async function AdminGymsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const admin = await requirePlatformAdmin();
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const status = sp.status || undefined;
  const result = await listGyms(admin.id, { q, status, page: Number(sp.page) || 1 });

  return (
    <>
      <PageHeader title="Gyms" description="Every gym on the platform, its plan and usage." />
      <Card className="gap-0 py-0">
        <form className="flex flex-wrap items-end gap-2 border-b p-4" role="search">
          <div className="relative w-full sm:w-72">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Search name or address…" className="pl-9" aria-label="Search gyms" />
          </div>
          <NativeSelect name="status" defaultValue={status ?? ""} className="w-full sm:w-44" aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="TRIAL">Trial</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="CANCELLED">Cancelled</option>
          </NativeSelect>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
        <GymsTable rows={result.gyms} />
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} noun="gyms" basePath="/admin/gyms" params={{ q, status }} />
      </Card>
    </>
  );
}
