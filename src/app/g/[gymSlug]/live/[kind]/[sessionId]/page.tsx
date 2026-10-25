import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { DeliveryBadge } from "@/components/live/live-ui";
import { Button } from "@/components/ui/button";
import { formatDate, localDate, localTime } from "@/domain/dates";
import { hasVideoRoom, joinTiming, joinWindow, LIVE_JOIN_MESSAGES } from "@/domain/live";
import { liveSessionInfo, liveSessionsAvailable } from "@/server/services/live/join";
import { hasPermission, requireGymAccess } from "@/server/tenant";
import { LiveRoom } from "./live-room";

export const metadata: Metadata = { title: "Live call" };

/** The trainer's video call for an online or hybrid class (as host) or an online PT session. */
export default async function LiveCallPage({ params }: { params: Promise<{ gymSlug: string; kind: string; sessionId: string }> }) {
  const { gymSlug, kind, sessionId } = await params;
  if (kind !== "class" && kind !== "pt") notFound();
  const ctx = await requireGymAccess(gymSlug);
  if (!hasPermission(ctx, "schedule.view")) return <AccessDenied what="live calls" />;
  if (!liveSessionsAvailable(ctx)) return <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{LIVE_JOIN_MESSAGES.notInPlan}</p>;
  const s = await liveSessionInfo(ctx, kind, sessionId);
  if (!s) notFound();

  const tz = ctx.gym.timezone;
  const back = kind === "class" ? `/g/${gymSlug}/classes/${s.id}` : `/g/${gymSlug}/pt/sessions?from=${localDate(s.startsAt, tz)}`;
  const timing = joinTiming(s.startsAt, s.endsAt);
  const blocked = !s.isTrainer
    ? kind === "pt"
      ? LIVE_JOIN_MESSAGES.notYours
      : LIVE_JOIN_MESSAGES.notTrainer
    : !hasVideoRoom(s.deliveryMode)
      ? LIVE_JOIN_MESSAGES.inPerson
      : s.status === "CANCELLED"
        ? LIVE_JOIN_MESSAGES.cancelled
        : s.status !== "SCHEDULED"
          ? LIVE_JOIN_MESSAGES.closed
          : timing === "ended"
            ? LIVE_JOIN_MESSAGES.ended
            : null;

  return (
    <>
      <PageHeader
        title={s.title}
        description={`${formatDate(localDate(s.startsAt, tz), tz, "long")} · ${localTime(s.startsAt, tz)}–${localTime(s.endsAt, tz)}`}
        actions={
          <Button asChild variant="ghost">
            <Link href={back}>
              <ChevronLeft aria-hidden /> Back
            </Link>
          </Button>
        }
      />
      <div className="mb-3">
        <DeliveryBadge mode={s.deliveryMode} />
      </div>
      {blocked ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{blocked}</p>
      ) : (
        <LiveRoom gymSlug={gymSlug} kind={kind} sessionId={s.id} isHost={kind === "class"} opensAt={timing === "too_early" ? joinWindow(s.startsAt, s.endsAt).opensAt.toISOString() : null} backHref={back} />
      )}
    </>
  );
}
