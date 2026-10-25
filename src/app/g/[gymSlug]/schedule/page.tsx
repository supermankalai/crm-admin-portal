import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { DeliveryBadge, JoinCallButton, placeLabel } from "@/components/live/live-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { weekDays, weekStart } from "@/domain/classes";
import { addDays, isDateString, localDate, localTime } from "@/domain/dates";
import { hasVideoRoom } from "@/domain/live";
import { cn } from "@/lib/utils";
import { todayFor } from "@/server/services/members/shared";
import { mySchedule } from "@/server/services/staff";
import { hasPermission, requireGymAccess } from "@/server/tenant";

export const metadata: Metadata = { title: "My schedule" };

const DAY = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ gymSlug: string }>; searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  if (!hasPermission(ctx, "schedule.view")) return <AccessDenied what="schedules" />;
  const sp = await searchParams;
  const today = todayFor(ctx);
  const monday = weekStart(sp.week && isDateString(sp.week) ? sp.week : today);
  const { shifts, classes, pts } = await mySchedule(ctx, monday);
  const tz = ctx.gym.timezone;
  const base = `/g/${ctx.gym.slug}/schedule`;

  return (
    <>
      <PageHeader title="My schedule" description="Your shifts, the classes you teach and your personal training sessions this week." />
      <div className="mb-4 flex items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label="Previous week">
          <Link href={`${base}?week=${addDays(monday, -7)}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={base}>This week</Link>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label="Next week">
          <Link href={`${base}?week=${addDays(monday, 7)}`}>
            <ChevronRight />
          </Link>
        </Button>
        {ctx.staffId && (
          <Button asChild variant="ghost" className="ml-auto">
            <Link href={`/g/${ctx.gym.slug}/staff/${ctx.staffId}`}>My profile</Link>
          </Button>
        )}
      </div>
      <div className="grid gap-3">
        {weekDays(monday).map((day) => {
          const dayShifts = shifts.filter((s) => localDate(s.startsAt, tz) === day);
          const dayClasses = classes.filter((c) => localDate(c.startsAt, tz) === day);
          const dayPts = pts.filter((p) => localDate(p.startsAt, tz) === day);
          return (
            <section key={day} className={cn("rounded-xl border bg-card p-4", day === today && "border-primary")} aria-label={DAY.format(new Date(`${day}T00:00:00Z`))}>
              <h2 className={cn("mb-2 text-sm font-semibold", day === today && "text-primary")}>{DAY.format(new Date(`${day}T00:00:00Z`))}</h2>
              {dayShifts.length === 0 && dayClasses.length === 0 && dayPts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <ul className="grid gap-1.5 text-sm">
                  {dayShifts.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <Badge variant="secondary">Shift</Badge>
                      {localTime(s.startsAt, tz)}–{localTime(s.endsAt, tz)} · {s.location.name}
                    </li>
                  ))}
                  {dayClasses.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2">
                      <Link href={`/g/${ctx.gym.slug}/classes/${c.id}`} className={cn("flex items-center gap-2 hover:underline", c.status === "CANCELLED" && "line-through opacity-60")}>
                        <span className="size-2 rounded-full" style={{ backgroundColor: c.classType.color }} aria-hidden />
                        {localTime(c.startsAt, tz)} {c.classType.name} · {placeLabel(c.deliveryMode, c.room?.name)} · {c._count.bookings}/{c.capacity} booked
                      </Link>
                      {c.status === "SCHEDULED" && hasVideoRoom(c.deliveryMode) && <JoinCallButton gymSlug={ctx.gym.slug} kind="class" sessionId={c.id} startsAt={c.startsAt} endsAt={c.endsAt} timeZone={tz} />}
                    </li>
                  ))}
                  {dayPts.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">PT</Badge>
                      {localTime(p.startsAt, tz)}–{localTime(p.endsAt, tz)} · {p.member.firstName} {p.member.lastName}
                      {p.focus ? ` · ${p.focus}` : ""}
                      <DeliveryBadge mode={p.deliveryMode} />
                      {p.status === "SCHEDULED" && p.deliveryMode === "ONLINE" && <JoinCallButton gymSlug={ctx.gym.slug} kind="pt" sessionId={p.id} startsAt={p.startsAt} endsAt={p.endsAt} timeZone={tz} />}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
