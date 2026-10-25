import Link from "next/link";
import { Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { localTime } from "@/domain/dates";
import { joinTiming, joinWindow, type DeliveryMode, type LiveKind } from "@/domain/live";

/** "Online" / "Hybrid" next to a class or PT session; nothing for in-person ones. */
export function DeliveryBadge({ mode }: { mode: DeliveryMode }) {
  if (mode === "IN_PERSON") return null;
  return (
    <Badge variant="info" className="gap-1">
      <Video className="size-3" aria-hidden /> {mode === "ONLINE" ? "Online" : "Hybrid"}
    </Badge>
  );
}

/** Where a class happens: its room, "Online", or both. */
export function placeLabel(mode: DeliveryMode, roomName: string | null | undefined): string {
  if (mode === "ONLINE" || !roomName) return "Online";
  return mode === "HYBRID" ? `${roomName} + online` : roomName;
}

/**
 * The trainer's way into the call: a Join button while the window is open, the opening time
 * before it, nothing once it has closed. The page behind it checks everything again.
 */
export function JoinCallButton({ gymSlug, kind, sessionId, startsAt, endsAt, timeZone, size = "sm" }: { gymSlug: string; kind: LiveKind; sessionId: string; startsAt: Date; endsAt: Date; timeZone: string; size?: "sm" | "default" }) {
  const timing = joinTiming(startsAt, endsAt);
  if (timing === "ended") return null;
  if (timing === "too_early") {
    return (
      <Button size={size} variant="outline" disabled title="You can join 10 minutes before the start">
        <Video aria-hidden /> Call opens {localTime(joinWindow(startsAt, endsAt).opensAt, timeZone)}
      </Button>
    );
  }
  return (
    <Button size={size} asChild>
      <Link href={`/g/${gymSlug}/live/${kind}/${sessionId}`}>
        <Video aria-hidden /> Join call
      </Link>
    </Button>
  );
}
