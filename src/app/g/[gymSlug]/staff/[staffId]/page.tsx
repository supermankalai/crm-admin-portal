import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, localTime } from "@/domain/dates";
import { formatMemberNumber } from "@/domain/member-search";
import { assignableRoles, ROLE_LABELS } from "@/domain/permissions";
import { NotFoundError } from "@/server/errors";
import { listCheckInLocations } from "@/server/services/checkin";
import { todayFor } from "@/server/services/members/shared";
import { getStaffProfile } from "@/server/services/staff";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { ClientControls, DeleteShift, ProfileForm, RemoveStaffButton, RoleControl, ShiftForm, UnassignClient } from "./staff-actions";

export const metadata: Metadata = { title: "Staff member" };

export default async function StaffProfilePage({ params }: { params: Promise<{ gymSlug: string; staffId: string }> }) {
  const { gymSlug, staffId } = await params;
  const ctx = await requireGymAccess(gymSlug);
  if (!hasPermission(ctx, "staff.view") && staffId !== ctx.staffId) return <AccessDenied what="staff profiles" />;
  const profile = await getStaffProfile(ctx, staffId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { staff } = profile;
  const tz = ctx.gym.timezone;
  const writable = ctx.access.writable && !ctx.supportSessionId && staff.status === "ACTIVE";
  const isOwner = hasPermission(ctx, "staff.manage");
  const isManager = hasPermission(ctx, "staff.invite");
  const locations = isManager && writable ? await listCheckInLocations(ctx).catch(() => []) : [];
  const when = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: tz });

  return (
    <>
      {hasPermission(ctx, "staff.view") && (
        <Link href={`/g/${gymSlug}/staff`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Staff
        </Link>
      )}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{staff.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{ROLE_LABELS[staff.role]}</Badge>
            {staff.status === "REMOVED" && <Badge variant="danger">Removed</Badge>}
            {staff.email} {staff.phone && `· ${staff.phone}`}
          </p>
          {staff.specialties.length > 0 && <p className="mt-1 text-sm">{staff.specialties.join(" · ")}</p>}
        </div>
        {writable && isOwner && !profile.isSelf && (
          <div className="flex flex-wrap items-end gap-3">
            <RoleControl gymSlug={gymSlug} staffId={staff.id} role={staff.role} roles={assignableRoles(ctx.role)} name={staff.name} />
            <RemoveStaffButton gymSlug={gymSlug} staffId={staff.id} name={staff.name} />
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            {writable && (profile.isSelf || isManager) ? (
              <ProfileForm
                gymSlug={gymSlug}
                staffId={staff.id}
                canEditNotes={isManager}
                defaults={{ staffId: staff.id, title: staff.title ?? "", bio: staff.bio ?? "", specialties: staff.specialties.join(", "), phone: staff.phone ?? "", notes: staff.notes ?? "" }}
              />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{staff.bio ?? "No bio yet."}</p>
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming classes</CardTitle>
            </CardHeader>
            <CardContent>
              {profile.upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming classes.</p>
              ) : (
                <ul className="grid gap-1.5 text-sm">
                  {profile.upcoming.map((c) => (
                    <li key={c.id}>
                      <Link href={`/g/${gymSlug}/classes/${c.id}`} className="flex items-center gap-2 hover:underline">
                        <span className="size-2 rounded-full" style={{ backgroundColor: c.classType.color }} aria-hidden />
                        {when.format(c.startsAt)} {localTime(c.startsAt, tz)} · {c.classType.name} · {c.room.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {staff.role === "TRAINER" && (
            <Card>
              <CardHeader>
                <CardTitle>Clients ({profile.clients.length})</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {profile.clients.length === 0 ? (
                  <EmptyState title="No clients assigned" />
                ) : (
                  <ul className="divide-y">
                    {profile.clients.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 py-1.5 text-sm">
                        <Link href={`/g/${gymSlug}/members/${m.id}`} className="flex-1 hover:underline">
                          {m.firstName} {m.lastName} <span className="font-mono text-xs text-muted-foreground">{formatMemberNumber(m.memberNumber)}</span>
                        </Link>
                        {writable && isManager && <UnassignClient gymSlug={gymSlug} staffId={staff.id} memberId={m.id} name={`${m.firstName} ${m.lastName}`} />}
                      </li>
                    ))}
                  </ul>
                )}
                {writable && isManager && <ClientControls gymSlug={gymSlug} staffId={staff.id} />}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Shifts (next 4 weeks)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {profile.shifts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No shifts scheduled.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {profile.shifts.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 py-1.5">
                      <span className="flex-1">
                        {when.format(s.startsAt)} · {localTime(s.startsAt, tz)}–{localTime(s.endsAt, tz)} · {s.location.name}
                      </span>
                      {writable && isManager && <DeleteShift gymSlug={gymSlug} staffId={staff.id} shiftId={s.id} />}
                    </li>
                  ))}
                </ul>
              )}
              {writable && isManager && locations.length > 0 && <ShiftForm gymSlug={gymSlug} staffId={staff.id} locations={locations} today={todayFor(ctx)} />}
            </CardContent>
          </Card>
          {staff.lastLoginAt && <p className="text-xs text-muted-foreground">Last signed in {formatDateTime(staff.lastLoginAt, tz)}</p>}
        </div>
      </div>
    </>
  );
}
