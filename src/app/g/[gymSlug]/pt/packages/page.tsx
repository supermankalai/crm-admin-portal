import type { Metadata } from "next";
import { Package } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, invoiceTotals } from "@/domain/money";
import { todayFor } from "@/server/services/members/shared";
import { listTrainers } from "@/server/services/pt/clients";
import { getCreditsRequired, listPackages } from "@/server/services/pt/packages";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { ArchivePackageButton, CreditsRequiredSwitch, PackageDialog, SellPackageDialog } from "../package-forms";
import { PtTabs } from "../pt-shared";

export const metadata: Metadata = { title: "PT packages" };

/** The PT package catalog: what the gym sells, and the owner's "credits required" switch. */
export default async function PtPackagesPage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "workouts.manage") || !ctx.staffId) return <AccessDenied what="personal training" />;
  const isManager = hasPermission(ctx, "pt.manage");
  const canSell = hasPermission(ctx, "payments.record");
  const [packages, required, trainers] = await Promise.all([listPackages(ctx), getCreditsRequired(ctx), canSell ? listTrainers(ctx) : Promise.resolve([])]);
  const slug = ctx.gym.slug;
  const currency = ctx.gym.currency;
  const canWrite = ctx.access.writable && !ctx.supportSessionId;

  return (
    <>
      <PageHeader
        title="PT packages"
        description="Sessions sold in bundles. Selling one issues an invoice; booked sessions use its credits, and a cancelled session gives its credit back."
        actions={
          canWrite && (
            <div className="flex flex-wrap gap-2">
              {canSell && <SellPackageDialog gymSlug={slug} today={todayFor(ctx)} currency={currency} taxRateBps={ctx.gym.taxRateBps} packages={packages} trainers={trainers} />}
              {isManager && <PackageDialog gymSlug={slug} currency={currency} />}
            </div>
          )
        }
      />
      <PtTabs slug={slug} active="packages" />

      <Card className="gap-0 py-0">
        {packages.length === 0 ? (
          <EmptyState icon={<Package />} title="No PT packages yet" description={isManager ? "Add one with New package, for example 10 sessions valid for 90 days." : "Owners and managers add the packages the gym sells."} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Package</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Valid for</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">With tax</TableHead>
                  <TableHead className="text-right">Per session</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead>Status</TableHead>
                  {isManager && canWrite && (
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="font-medium">{p.name}</span>
                      {p.description && <span className="block text-xs text-muted-foreground">{p.description}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.sessionCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.validityDays} days</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(p.priceMinor, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(invoiceTotals(p.priceMinor, ctx.gym.taxRateBps).totalMinor, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(Math.round(p.priceMinor / p.sessionCount), currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.sold}</TableCell>
                    <TableCell>{p.isActive ? <Badge variant="success">On sale</Badge> : <Badge variant="secondary">Not on sale</Badge>}</TableCell>
                    {isManager && canWrite && (
                      <TableCell className="text-right whitespace-nowrap">
                        <PackageDialog gymSlug={slug} currency={currency} pkg={p} />
                        <ArchivePackageButton gymSlug={slug} pkg={p} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Booking rule</CardTitle>
          <CardDescription>{required ? "PT sessions need a package credit." : "PT sessions can be booked without a package."}</CardDescription>
        </CardHeader>
        <CardContent>
          {hasPermission(ctx, "settings.manage") && canWrite ? (
            <CreditsRequiredSwitch gymSlug={slug} required={required} />
          ) : (
            <p className="text-sm text-muted-foreground">Only the gym owner can change this.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
