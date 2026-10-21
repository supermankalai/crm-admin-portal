"use client";

import "@livekit/components-styles";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ControlBar, GridLayout, LiveKitRoom, ParticipantTile, RoomAudioRenderer, useParticipants, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Loader2, MicOff, UserX, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { joinLiveAction, moderateLiveAction } from "../../actions";

type Join = { url: string; token: string };

/**
 * The call itself. Joining asks the server for a token (it checks again that this is your session
 * and that the call is open), then connects straight to LiveKit with camera and mic on. Leaving,
 * or the session being cancelled, ends the connection.
 */
export function LiveRoom({ gymSlug, kind, sessionId, isHost, opensAt, backHref }: { gymSlug: string; kind: "class" | "pt"; sessionId: string; isHost: boolean; opensAt: string | null; backHref: string }) {
  const router = useRouter();
  const [join, setJoin] = useState<Join | null>(null);
  const [pending, startTransition] = useTransition();

  const connect = () =>
    startTransition(async () => {
      const r = await joinLiveAction(gymSlug, { kind, sessionId });
      if (!r.ok) return void toast.error(r.error);
      setJoin({ url: r.data.url, token: r.data.token });
    });

  if (!join) {
    const opens = opensAt ? new Date(opensAt) : null;
    return (
      <div className="grid justify-items-start gap-3 rounded-xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          {opens
            ? `The call opens at ${opens.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, 10 minutes before the start.`
            : isHost
              ? "You're the host: booked members can join from the app. Your camera and microphone turn on when you join; you can mute or remove people."
              : "Your client joins from the app. Your camera and microphone turn on when you join."}
        </p>
        <Button onClick={connect} disabled={pending || !!opens}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Video aria-hidden />} Join call
        </Button>
      </div>
    );
  }

  return (
    <LiveKitRoom
        serverUrl={join.url}
        token={join.token}
        connect
        video
        audio
        data-lk-theme="default"
        className="flex h-[75vh] min-h-96 flex-col overflow-hidden rounded-xl md:flex-row"
        onDisconnected={() => {
          setJoin(null);
          router.push(backHref);
        }}
        onError={(error) => toast.error(error.message || "The call couldn't connect.")}
        onMediaDeviceFailure={() => toast.error("Your camera or microphone couldn't be used. Check the browser's permission for this site.")}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Stage />
          <ControlBar controls={{ chat: false, settings: false, screenShare: true, leave: true }} />
        </div>
        {isHost && <HostPanel gymSlug={gymSlug} sessionId={sessionId} />}
        <RoomAudioRenderer />
      </LiveKitRoom>
  );
}

function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );
  return (
    <GridLayout tracks={tracks} className="min-h-0 flex-1">
      <ParticipantTile />
    </GridLayout>
  );
}

/** The class host's list of who's in the call, with mute and remove. */
function HostPanel({ gymSlug, sessionId }: { gymSlug: string; sessionId: string }) {
  const participants = useParticipants();
  const [pending, startTransition] = useTransition();
  const others = participants.filter((p) => !p.isLocal);
  const act = (identity: string, name: string, action: "mute" | "remove") =>
    startTransition(async () => {
      const r = await moderateLiveAction(gymSlug, { sessionId, identity, action });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data.done ? (action === "mute" ? `${name} is muted.` : `${name} was removed from the call.`) : `${name} has already left.`);
    });

  return (
    <aside aria-label="People in the call" className="max-h-40 shrink-0 overflow-y-auto border-t border-white/10 p-3 text-white md:max-h-none md:w-64 md:border-t-0 md:border-l">
      <h2 className="mb-2 text-sm font-semibold">In the call ({others.length})</h2>
      {others.length === 0 ? (
        <p className="text-sm text-white/70">Nobody else yet.</p>
      ) : (
        <ul className="grid gap-1.5">
          {others.map((p) => {
            const name = p.name || "Guest";
            return (
              <li key={p.identity} className="flex items-center gap-1 text-sm">
                <span className="flex-1 truncate">{name}</span>
                <Button size="icon" variant="ghost" className="size-7 text-white hover:bg-white/10" disabled={pending || !p.isMicrophoneEnabled} onClick={() => act(p.identity, name, "mute")} aria-label={`Mute ${name}`} title="Mute">
                  <MicOff aria-hidden />
                </Button>
                <Button size="icon" variant="ghost" className="size-7 text-red-300 hover:bg-white/10" disabled={pending} onClick={() => act(p.identity, name, "remove")} aria-label={`Remove ${name} from the call`} title="Remove">
                  <UserX aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
