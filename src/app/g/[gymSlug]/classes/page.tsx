import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Settings2 } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { UpgradeNotice } from "@/components/upgrade-notice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { weekDays, weekStart } from "@/domain/classes";
import { addDays, isDateString, localTime } from "@/domain/dates";
import { featureMessage } from "@/domain/plan-limits";
import { cn } from "@/lib/utils";
import { hasFeature, planLimitsOf } from "@/server/plan/limits";
import { listClassSetup } from "@/server/services/classes/setup";
import { listWeek, ownSessionsOnly } from "@/server/services/classes/sessions";
import { todayFor } from "@/server/services/members/shared";
import { hasPermission, requireGymAccess } from "@/server/tenant";

export const metadata: Metadata = { title: "Classes" };

const DAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export default async function ClassesPage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<{ week?: string; trainer?: string; location?: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "classes.view")) return <AccessDenied what="classes" />;
  const sp = await searchParams;
  const today = todayFor(ctx);
  const monday = weekStart(sp.week && isDateString(sp.week) ? sp.week : today);
  const own = ownSessionsOnly(ctx);
  const [sessions, setup] = await Promise.all([listWeek(ctx, monday, { trainerId: own ? undefined : sp.trainer || undefined, locationId: sp.location || undefined }), listClassSetup(ctx)]);
  const days = weekDays(monday);
  const base = `/g/${ctx.gym.slug}/classes`;
  const q = (week: string) => `${base}?week=${week}${sp.trainer ? `&trainer=${sp.trainer}` : ""}${sp.location ? `&location=${sp.location}` : ""}`;
  const canManage = hasPermission(ctx, "classes.manage") && ctx.access.writable && !ctx.supportSessionId;
  const tz = ctx.gym.timezone;

  return (
    <>
      <PageHeader
        title={own ? "My classes" : "Classes"}
        description={own ? "The classes you teach." : "Weekly timetable. Open a class to book members, manage the waitlist and mark attendance."}
        actions={
          canManage && (
            <>
              <Button asChild variant="outline">
                <Link href={`${base}/setup`}>
                  <Settings2 aria-hidden /> Class types &amp; rooms
                </Link>
              </Button>
              <Button asChild>
                <Link href={`${base}/new`}>
                  <Plus aria-hidden /> Schedule class
                </Link>
              </Button>
            </>
          )
        }
      />
      {!hasFeature(ctx, "classBookings") && <div className="mb-4"><UpgradeNotice message={featureMessage(planLimitsOf(ctx), "classBookings")} canManageBilling={hasPermission(ctx, "billing.manage")} /></div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label="Previous week">
          <Link href={q(addDays(monday, -7))}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={q(weekStart(today))}>This week</Link>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label="Next week">
          <Link href={q(addDays(monday, 7))}>
            <ChevronRight />
          </Link>
        </Button>
        <p className="font-medium">
          {DAY.format(new Date(`${monday}T00:00:00Z`))} – {DAY.format(new Date(`${addDays(monday, 6)}T00:00:00Z`))}
        </p>
        {!own && (
          <form className="ml-auto flex flex-wrap gap-2">
            <input type="hidden" name="week" value={monday} />
            <NativeSelect name="trainer" defaultValue={sp.trainer ?? ""} className="w-44" aria-label="Filter by trainer">
              <option value="">All trainers</option>
              {setup.trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
            {setup.locations.length > 1 && (
              <NativeSelect name="location" defaultValue={sp.location ?? ""} className="w-40" aria-label="Filter by location">
                <option value="">All locations</option>
                {setup.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            )}
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
        )}
      </div>

      {sessions.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarDays />} title="No classes this week" description={canManage ? "Schedule a class to get started." : undefined} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-7 [&>*]:min-w-0">
          {days.map((day) => {
            const list = sessions.filter((s) => s.date === day);
            return (
              <section key={day} aria-label={DAY.format(new Date(`${day}T00:00:00Z`))} className={cn("rounded-xl border bg-card p-2", day === today && "border-primary ring-1 ring-primary/30")}>
                <h2 className={cn("mb-2 px-1 text-xs font-semibold text-muted-foreground uppercase", day === today && "text-primary")}>{DAY.format(new Date(`${day}T00:00:00Z`))}</h2>
                <ul className="grid gap-2">
                  {list.length === 0 && <li className="px-1 text-xs text-muted-foreground">—</li>}
                  {list.map((s) => {
                    const full = s.booked >= s.capacity;
                    return (
                      <li key={s.id}>
                        <Link
                          href={`${base}/${s.id}`}
                          className={cn("block rounded-md border-l-4 bg-muted/40 p-2 text-xs transition-colors hover:bg-accent", s.status === "CANCELLED" && "opacity-60 line-through")}
                          style={{ borderLeftColor: s.classType.color }}
                        >
                          <span className="block font-semibold">{localTime(s.startsAt, tz)} {s.classType.name}</span>
                          <span className="block truncate text-muted-foreground">
                            {s.trainer.user.name} · {s.room.name}
                          </span>
                          <span className={cn("mt-1 inline-block rounded px-1.5 py-0.5 font-medium tabular-nums", full ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-background")}>
                            {s.status === "CANCELLED" ? "Cancelled" : `${s.booked}/${s.capacity}${s.waitlisted ? ` +${s.waitlisted} waiting` : ""}`}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
