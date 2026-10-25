import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { MemberAvatar } from "@/components/members/member-avatar";
import { UpgradeNotice } from "@/components/upgrade-notice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canMarkAttendance } from "@/domain/classes";
import { localDate, localTime } from "@/domain/dates";
import { formatMemberNumber } from "@/domain/member-search";
import { featureMessage } from "@/domain/plan-limits";
import { NotFoundError } from "@/server/errors";
import { hasFeature, planLimitsOf } from "@/server/plan/limits";
import { getSession } from "@/server/services/classes/sessions";
import { listClassSetup } from "@/server/services/classes/setup";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { BookingRowActions, BookMember, CancelSession, EditSession } from "./session-actions";

export const metadata: Metadata = { title: "Class" };

const STATUS: Record<string, { label: string; variant: "success" | "secondary" | "warning" | "danger" | "info" }> = {
  BOOKED: { label: "Booked", variant: "info" },
  ATTENDED: { label: "Attended", variant: "success" },
  NO_SHOW: { label: "No-show", variant: "danger" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
  WAITLISTED: { label: "Waitlist", variant: "warning" },
};

export default async function SessionPage({ params }: { params: Promise<{ gymSlug: string; sessionId: string }> }) {
  const { gymSlug, sessionId } = await params;
  const ctx = await requireGymAccess(gymSlug);
  if (!hasPermission(ctx, "classes.view")) return <AccessDenied what="classes" />;
  const session = await getSession(ctx, sessionId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const tz = ctx.gym.timezone;
  const writable = ctx.access.writable && !ctx.supportSessionId;
  const isOwnClass = session.trainerId === ctx.staffId;
  const canManage = writable && (hasPermission(ctx, "classes.manage") || (hasPermission(ctx, "classes.manageOwn") && isOwnClass));
  const canBook = writable && (hasPermission(ctx, "classes.book") || hasPermission(ctx, "classes.manage")) && hasFeature(ctx, "classBookings");
  const upcoming = session.status === "SCHEDULED" && session.endsAt > new Date();
  const confirmed = session.bookings.filter((b) => b.status === "BOOKED" || b.status === "ATTENDED" || b.status === "NO_SHOW");
  const waitlist = session.bookings.filter((b) => b.status === "WAITLISTED");
  const cancelled = session.bookings.filter((b) => b.status === "CANCELLED");
  const attendanceOpen = canManage && session.status !== "CANCELLED" && canMarkAttendance(session);
  const setup = canManage && upcoming ? await listClassSetup(ctx) : null;
  const date = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(session.startsAt);

  const row = (b: (typeof session.bookings)[number]) => {
    const name = `${b.member.firstName} ${b.member.lastName}`;
    return (
      <li key={b.id} className="flex flex-wrap items-center gap-3 py-2">
        {b.status === "WAITLISTED" && <span className="w-6 text-center font-mono text-sm text-muted-foreground">#{b.waitlistPosition}</span>}
        <MemberAvatar name={name} gymSlug={gymSlug} photoFileId={b.member.photoFileId} size="sm" />
        <Link href={`/g/${gymSlug}/members/${b.member.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
          {name} <span className="font-mono text-xs text-muted-foreground">{formatMemberNumber(b.member.memberNumber)}</span>
        </Link>
        <Badge variant={STATUS[b.status].variant}>{STATUS[b.status].label}</Badge>
        <BookingRowActions gymSlug={gymSlug} sessionId={session.id} bookingId={b.id} name={name} status={b.status} canCancel={upcoming && (canBook || canManage)} canMark={attendanceOpen} />
      </li>
    );
  };

  return (
    <>
      <Link href={`/g/${gymSlug}/classes?week=${localDate(session.startsAt, tz)}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Timetable
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-1 h-10 w-1.5 rounded-full" style={{ backgroundColor: session.classType.color }} aria-hidden />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{session.classType.name}</h1>
            <p className="text-sm text-muted-foreground">
              {date} · {localTime(session.startsAt, tz)}–{localTime(session.endsAt, tz)} · {session.room.location.name}, {session.room.name} · with {session.trainer.user.name}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {session.status === "CANCELLED" ? <Badge variant="danger">Cancelled</Badge> : <Badge variant={confirmed.length >= session.capacity ? "warning" : "secondary"}>{confirmed.length}/{session.capacity} booked</Badge>}
              {waitlist.length > 0 && <Badge variant="warning">{waitlist.length} on waitlist</Badge>}
            </div>
          </div>
        </div>
        {canManage && upcoming && setup && (
          <div className="flex flex-wrap gap-2">
            <EditSession gymSlug={gymSlug} session={session} rooms={setup.rooms} trainers={setup.trainers} canChangeStaffing={hasPermission(ctx, "classes.manage")} />
            <CancelSession gymSlug={gymSlug} sessionId={session.id} booked={confirmed.length} />
          </div>
        )}
      </div>

      {!hasFeature(ctx, "classBookings") && <div className="mb-4"><UpgradeNotice message={featureMessage(planLimitsOf(ctx), "classBookings")} canManageBilling={hasPermission(ctx, "billing.manage")} /></div>}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Booked ({confirmed.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {confirmed.length === 0 ? <EmptyState title="No bookings yet" /> : <ul className="divide-y">{confirmed.map(row)}</ul>}
            {attendanceOpen && confirmed.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Mark attendance from 30 minutes before the class until a day after.</p>}
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          {canBook && upcoming && (
            <Card>
              <CardContent>
                <BookMember gymSlug={gymSlug} sessionId={session.id} full={confirmed.length >= session.capacity} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Waitlist ({waitlist.length})</CardTitle>
            </CardHeader>
            <CardContent>{waitlist.length === 0 ? <p className="text-sm text-muted-foreground">Nobody waiting.</p> : <ul className="divide-y">{waitlist.map(row)}</ul>}</CardContent>
          </Card>
          {cancelled.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Cancelled ({cancelled.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">{cancelled.map(row)}</ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
