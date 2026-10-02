import "server-only";
import { recordPlatformAudit } from "@/server/audit/platform-audit";
import { hashPassword } from "@/server/auth/password";
import { withAnonymous, withUser, type Tx } from "@/server/db/context";
import { ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";

export type SignupGym = { gymName: string; slug: string; timezone: string; currency: string; planCode: string };
export type SignupOwner = { ownerName: string; email: string; password: string };

type Row = { gym_id: string; user_id: string; trial_ends_at: Date };

const FRIENDLY: Record<string, [field: string, message: string]> = {
  "signup:slug_taken": ["slug", "This address is already taken. Try another."],
  "signup:email_taken": ["email", "An account with this email already exists. Sign in first, then add a gym."],
  "signup:invalid_plan": ["planCode", "Choose one of the available plans."],
  "signup:missing_owner": ["email", "Enter the owner's account details."],
  "signup:unknown_user": ["email", "Your session has expired. Sign in again."],
};

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  for (const [key, [field, text]] of Object.entries(FRIENDLY)) {
    if (message.includes(key)) throw new ValidationError(text, { [field]: [text] });
  }
  // Concurrent sign-ups racing for the same slug or email hit the unique constraints instead.
  if (/Gym_slug_key/.test(message)) throw new ValidationError(FRIENDLY["signup:slug_taken"][1], { slug: [FRIENDLY["signup:slug_taken"][1]] });
  if (/User_email_key/.test(message)) throw new ValidationError(FRIENDLY["signup:email_taken"][1], { email: [FRIENDLY["signup:email_taken"][1]] });
  throw error;
}

async function run(tx: Tx, gym: SignupGym, owner: { name: string; email: string; passwordHash: string } | null, meta: RequestMeta) {
  const rows = await tx.$queryRaw<Row[]>`
    SELECT * FROM signup_create_gym(
      ${gym.slug}, ${gym.gymName}, ${gym.timezone}, ${gym.currency}, ${gym.planCode},
      ${owner?.email ?? null}, ${owner?.name ?? null}, ${owner?.passwordHash ?? null})`;
  const row = rows[0];
  await recordPlatformAudit(tx, {
    action: "gym.signup",
    actorUserId: row.user_id,
    gymId: row.gym_id,
    targetType: "Gym",
    targetId: row.gym_id,
    metadata: { slug: gym.slug, plan: gym.planCode, newUser: owner !== null },
    meta,
  });
  return { gymId: row.gym_id, userId: row.user_id, trialEndsAt: row.trial_ends_at };
}

/** Sign-up for a visitor without an account: creates the owner user too. */
export async function signupWithNewOwner(gym: SignupGym, owner: SignupOwner, meta: RequestMeta) {
  const passwordHash = await hashPassword(owner.password);
  try {
    return await withAnonymous((tx) => run(tx, gym, { name: owner.ownerName, email: owner.email, passwordHash }, meta));
  } catch (error) {
    mapDatabaseError(error);
  }
}

/** A signed-in user adding another gym: they become its owner. */
export async function signupForExistingUser(userId: string, gym: SignupGym, meta: RequestMeta) {
  try {
    return await withUser(userId, (tx) => run(tx, gym, null, meta));
  } catch (error) {
    mapDatabaseError(error);
  }
}
