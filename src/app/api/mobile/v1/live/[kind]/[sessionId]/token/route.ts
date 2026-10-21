import { api } from "@fitcrm/shared/api/contract";
import { mobileRoute } from "@/server/mobile/route";
import { joinAsMember, joinAsStaff, type LiveJoin } from "@/server/services/live/join";

const out = (j: LiveJoin) => ({
  ...j,
  expiresAt: j.expiresAt.toISOString(),
  session: { ...j.session, startsAt: j.session.startsAt.toISOString(), endsAt: j.session.endsAt.toISOString() },
});

/** The same join rules for both apps; who you are decides what you may join and with what rights. */
export const POST = mobileRoute(api.liveJoin, async ({ auth, params }) =>
  out(auth.kind === "staff" ? await joinAsStaff(auth.staff, params.kind, params.sessionId) : await joinAsMember(auth.member, params.kind, params.sessionId))
);
