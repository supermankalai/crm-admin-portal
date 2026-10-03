import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { LinkTabs } from "@/components/link-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CURRENCIES, formatTaxPercent, minutesToHHMM, timeZones } from "@/lib/validation/settings";
import { planLimitsOf } from "@/server/plan/limits";
import { getSettings } from "@/server/services/settings";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { BrandingForm, GymProfileForm, LocationDialog, LogoControl, OpeningHoursForm } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

const TABS = [
  { key: "general", label: "Gym profile" },
  { key: "hours", label: "Locations & hours" },
  { key: "branding", label: "Branding" },
] as const;

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "settings.manage")) return <AccessDenied what="gym settings" />;
  const requested = (await searchParams).tab;
  const tab = TABS.find((t) => t.key === requested)?.key ?? "general";
  const settings = await getSettings(ctx);
  const base = `/g/${ctx.gym.slug}/settings`;
  const readOnly = !ctx.access.writable || !!ctx.supportSessionId;
  const plan = planLimitsOf(ctx);
  const activeLocations = settings.locations.filter((l) => l.isActive).length;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your gym's details, opening hours and branding. Every change is recorded in the audit log."
        actions={
          hasPermission(ctx, "billing.manage") && (
            <Button asChild variant="outline">
              <Link href={`/g/${ctx.gym.slug}/billing`}>
                Plan &amp; billing <ArrowRight aria-hidden />
              </Link>
            </Button>
          )
        }
      />
      <LinkTabs label="Settings sections" active={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `${base}?tab=${t.key}` }))} />
      <div className="mt-4 grid max-w-4xl gap-4">
        {tab === "general" && (
          <Card>
            <CardHeader>
              <CardTitle>Gym profile</CardTitle>
              <CardDescription>Shown on invoices and to your staff. The time zone decides what &ldquo;today&rdquo; means for check-ins, classes and reports.</CardDescription>
            </CardHeader>
            <CardContent>
              <GymProfileForm
                gymSlug={ctx.gym.slug}
                readOnly={readOnly}
                currencyLocked={settings.currencyLocked}
                timeZones={timeZones(settings.gym.timezone)}
                currencies={CURRENCIES.map((c) => ({ ...c }))}
                defaults={{
                  name: settings.gym.name,
                  email: settings.gym.email ?? "",
                  phone: settings.gym.phone ?? "",
                  address: settings.gym.address ?? "",
                  timezone: settings.gym.timezone,
                  currency: settings.gym.currency,
                  taxRate: formatTaxPercent(settings.gym.taxRateBps),
                }}
              />
            </CardContent>
          </Card>
        )}

        {tab === "hours" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {activeLocations} of {plan.maxLocations} locations on the {plan.name} plan.
              </p>
              {!readOnly && <LocationDialog gymSlug={ctx.gym.slug} atLimit={activeLocations >= plan.maxLocations} />}
            </div>
            {settings.locations.map((loc) => (
              <Card key={loc.id}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle>{loc.name}</CardTitle>
                    <CardDescription>{loc.address ?? "No address"}</CardDescription>
                  </div>
                  {!readOnly && <LocationDialog gymSlug={ctx.gym.slug} location={{ id: loc.id, name: loc.name, address: loc.address ?? "" }} />}
                </CardHeader>
                <CardContent>
                  <OpeningHoursForm
                    gymSlug={ctx.gym.slug}
                    locationId={loc.id}
                    locationName={loc.name}
                    readOnly={readOnly}
                    days={Array.from({ length: 7 }, (_, d) => {
                      const h = loc.openingHours.find((x) => x.dayOfWeek === d);
                      return { dayOfWeek: d, isClosed: h?.isClosed ?? false, open: minutesToHHMM(h?.openMinute ?? 360), close: minutesToHHMM(h?.closeMinute ?? 1320) };
                    })}
                  />
                </CardContent>
              </Card>
            ))}
          </>
        )}

        {tab === "branding" && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Logo</CardTitle>
                <CardDescription>JPEG, PNG or WebP, up to 2 MB. Square images look best.</CardDescription>
              </CardHeader>
              <CardContent>
                <LogoControl gymSlug={ctx.gym.slug} readOnly={readOnly} logoUrl={settings.gym.logoFileId ? `/api/g/${ctx.gym.slug}/files/${settings.gym.logoFileId}` : null} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Brand colour</CardTitle>
                <CardDescription>Used for your gym&apos;s mark in the sidebar and gym switcher.</CardDescription>
              </CardHeader>
              <CardContent>
                <BrandingForm gymSlug={ctx.gym.slug} readOnly={readOnly} brandColor={settings.gym.brandColor} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
