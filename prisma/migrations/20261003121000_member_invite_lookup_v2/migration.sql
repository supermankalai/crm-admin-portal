-- member_invite_lookup also returns the invite id and encrypted phone (so a new account's phone
-- can be re-encrypted under the user's own context) and whether the gym's plan includes the
-- member app (enforced when the invite is redeemed). The return type changes, so drop + create.

DROP FUNCTION member_invite_lookup(text);

CREATE FUNCTION member_invite_lookup(p_token_hash text)
RETURNS TABLE (state text, invite_id text, gym_id text, gym_slug text, gym_name text, brand_color text, first_name text,
               channel text, email text, phone_enc text, phone_blind text, existing_user_id text, member_app boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT CASE WHEN i."revokedAt" IS NOT NULL OR m."deletedAt" IS NOT NULL THEN 'revoked'
              WHEN i."usedAt" IS NOT NULL THEN 'used'
              WHEN i."expiresAt" <= now() THEN 'expired'
              ELSE 'valid' END,
         i.id, g.id, g.slug, g.name, g."brandColor", m."firstName", i.channel::text, i.email, i."phoneEnc", i."phoneBlindIndex",
         (SELECT u.id FROM "User" u
           WHERE (i.email IS NOT NULL AND u.email = i.email)
              OR (i."phoneBlindIndex" IS NOT NULL AND u."phoneBlindIndex" = i."phoneBlindIndex") LIMIT 1),
         coalesce((SELECT p."featureMemberApp" FROM "GymSubscription" s JOIN "PlatformPlan" p ON p.id = s."planId"
                    WHERE s."gymId" = g.id), false)
    FROM "MemberAppInvite" i JOIN "Gym" g ON g.id = i."gymId" JOIN "Member" m ON m.id = i."memberId"
   WHERE i."tokenHash" = p_token_hash
$$;

REVOKE ALL ON FUNCTION member_invite_lookup(text) FROM PUBLIC;
