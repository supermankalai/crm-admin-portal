import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/domain/money";
import { requirePlatformAdmin } from "@/server/platform/guard";
import { listPlans } from "@/server/platform/services";
import { PlanForm } from "./plan-form";

export const metadata: Metadata = { title: "Plans" };

export default async function AdminPlansPage() {
  const admin = await requirePlatformAdmin();
  const plans = await listPlans(admin.id);
  return (
    <>
      <PageHeader title="Platform plans" description="Limits and feature flags are enforced on the server for every gym on the plan." />
      <div className="grid gap-4">
        {plans.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle>
                {p.name} <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
              </CardTitle>
              <CardDescription>{formatMoney(p.priceMonthlyMinor, p.currency)} per month</CardDescription>
            </CardHeader>
            <CardContent>
              <PlanForm
                gymCount={p.gymCount}
                plan={{
                  code: p.code,
                  name: p.name,
                  description: p.description,
                  priceMonthlyMinor: p.priceMonthlyMinor,
                  maxMembers: p.maxMembers,
                  maxStaff: p.maxStaff,
                  maxLocations: p.maxLocations,
                  featureReports: p.featureReports,
                  featureCsvExport: p.featureCsvExport,
                  featureClassBookings: p.featureClassBookings,
                  isActive: p.isActive,
                }}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
