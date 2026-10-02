import "server-only";
import { hashPassword } from "@/server/auth/password";
import { withAnonymous, withUser } from "@/server/db/context";
import { PlanLimitError, ValidationError } from "@/server/errors";
import { hashInviteToken } from "./staff";

/** The public side of staff invitations (no tenant context exists yet). */

export type InvitationView = { gymName: string; gymSlug: string; email: string; role: string; state: "valid" | "expired" | "used" | "revoked"; hasAccount: boolean };

export async function lookupInvitation(token: string): Promise<InvitationView | null> {
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const rows = await withAnonymous((tx) =>
    tx.$queryRaw<{ gym_name: string; gym_slug: string; email: string; role: string; state: InvitationView["state"]; has_account: boolean }[]>`
      SELECT * FROM invitation_lookup(${hashInviteToken(token)})`
  );
  const r = rows[0];
  return r ? { gymName: r.gym_name, gymSlug: r.gym_slug, email: r.email, role: r.role, state: r.state, hasAccount: r.has_account } : null;
}

const MESSAGES: Record<string, string> = {
  "invite:not_found": "This invitation link is not valid.",
  "invite:revoked": "This invitation was withdrawn. Ask the gym to send a new one.",
  "invite:used": "This invitation has already been used.",
  "invite:expired": "This invitation has expired. Ask the gym to send a new one.",
  "invite:login_required": "Sign in with the invited email address to accept.",
  "invite:email_mismatch": "You're signed in with a different email address than the one invited.",
  "invite:missing_account_details": "Enter your name and a password to create your account.",
  "invite:already_member": "You already work at this gym.",
};

function mapError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("plan_limit:staff")) throw new PlanLimitError("This gym has reached its plan's staff limit. Ask the owner to upgrade.");
  for (const [key, text] of Object.entries(MESSAGES)) if (message.includes(key)) throw new ValidationError(text);
  throw error;
}

type AcceptRow = { user_id: string; gym_slug: string; created_user: boolean };

/** Accept as the signed-in user (whose email must match the invitation). */
export async function acceptInvitationAsUser(userId: string, token: string) {
  try {
    const [row] = await withUser(userId, (tx) => tx.$queryRaw<AcceptRow[]>`SELECT * FROM invitation_accept(${hashInviteToken(token)}, NULL, NULL)`);
    return { gymSlug: row.gym_slug };
  } catch (error) {
    mapError(error);
  }
}

/** Accept by creating a new account for the invited email. */
export async function acceptInvitationWithNewAccount(token: string, name: string, password: string) {
  const passwordHash = await hashPassword(password);
  try {
    const [row] = await withAnonymous((tx) => tx.$queryRaw<AcceptRow[]>`SELECT * FROM invitation_accept(${hashInviteToken(token)}, ${name}, ${passwordHash})`);
    return { gymSlug: row.gym_slug };
  } catch (error) {
    mapError(error);
  }
}
