import { useMutation } from "@tanstack/react-query";
import { hasVideoRoom, joinTiming, joinWindow, type DeliveryMode, type LiveKind } from "@fitcrm/shared/domain/live";
import { api } from "./session";

/**
 * Live sessions (online classes and PT) in the app: when a call can be joined, how to open it,
 * and the join token. The server decides who may join; the app only offers the button.
 */

export type LiveLink = { kind: LiveKind; sessionId: string };

/** "none" (in person, or not yours to join), "early" (opens at `opensAt`), "open" or "ended". */
export function liveState(mode: DeliveryMode, startsAt: string, endsAt: string, now: number): { state: "none" | "early" | "open" | "ended"; opensAt: Date } {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const { opensAt } = joinWindow(s, e);
  if (!hasVideoRoom(mode)) return { state: "none", opensAt };
  const t = joinTiming(s, e, new Date(now));
  return { state: t === "too_early" ? "early" : t, opensAt };
}

export function liveHref(link: LiveLink) {
  return { pathname: "/live/[kind]/[sessionId]" as const, params: { kind: link.kind, sessionId: link.sessionId } };
}

const LINK = /^(class|pt):([A-Za-z0-9-]{1,64})$/;

/** The call a push alert points at ("class:<id>" / "pt:<id>"), or null. The payload is untrusted. */
export function parseLiveLink(value: unknown): LiveLink | null {
  const m = typeof value === "string" ? LINK.exec(value) : null;
  return m ? { kind: m[1] as LiveKind, sessionId: m[2] } : null;
}

/** Ask the server for a token to join this call (it checks the booking, the time and the plan). */
export function useLiveToken() {
  return useMutation({ mutationFn: (link: LiveLink) => api.call("liveJoin", { params: { kind: link.kind, sessionId: link.sessionId } }) });
}
