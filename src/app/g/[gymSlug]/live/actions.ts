"use server";

import { liveJoinSchema, liveModerateSchema } from "@/lib/validation/live";
import { gymAction } from "@/server/actions/gym-action";
import { joinAsStaff, moderateLive } from "@/server/services/live/join";

/**
 * Live calls from the web portal. The services check that you're the session's trainer, that the
 * call is open and that the plan includes it; the token is for that one room and expires when the
 * session's window closes.
 */

export const joinLiveAction = gymAction({ permission: "schedule.view", schema: liveJoinSchema, write: false }, async (ctx, input) => {
  const j = await joinAsStaff(ctx, input.kind, input.sessionId);
  return { url: j.url, token: j.token, role: j.role, identity: j.identity, expiresAt: j.expiresAt.toISOString() };
});

export const moderateLiveAction = gymAction({ permission: "schedule.view", schema: liveModerateSchema, write: false }, (ctx, input) =>
  moderateLive(ctx, input.sessionId, input.identity, input.action)
);
