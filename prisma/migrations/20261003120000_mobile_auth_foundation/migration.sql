-- CreateEnum
CREATE TYPE "MemberAccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MemberInviteChannel" AS ENUM ('EMAIL', 'SMS', 'CODE');

-- AlterTable
ALTER TABLE "PlatformPlan" ADD COLUMN     "featureMemberApp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featureMobileApp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneBlindIndex" TEXT,
ADD COLUMN     "phoneEnc" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MemberAccount" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "MemberAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MemberAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberAppInvite" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "channel" "MemberInviteChannel" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT,
    "phoneEnc" TEXT,
    "phoneBlindIndex" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MemberAppInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identifierHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoginOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileDeviceSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "ip" TEXT,
    "sessionVersion" INTEGER NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MobileDeviceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileRefreshToken" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MobileRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberAccount_userId_idx" ON "MemberAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberAccount_gymId_id_key" ON "MemberAccount"("gymId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MemberAccount_gymId_memberId_key" ON "MemberAccount"("gymId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberAccount_gymId_userId_key" ON "MemberAccount"("gymId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberAccount_memberId_key" ON "MemberAccount"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberAppInvite_tokenHash_key" ON "MemberAppInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberAppInvite_gymId_memberId_idx" ON "MemberAppInvite"("gymId", "memberId");

-- CreateIndex
CREATE INDEX "LoginOtp_identifierHash_createdAt_idx" ON "LoginOtp"("identifierHash", "createdAt");

-- CreateIndex
CREATE INDEX "MobileDeviceSession_userId_revokedAt_idx" ON "MobileDeviceSession"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MobileRefreshToken_tokenHash_key" ON "MobileRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MobileRefreshToken_sessionId_idx" ON "MobileRefreshToken"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneBlindIndex_key" ON "User"("phoneBlindIndex");

-- AddForeignKey
ALTER TABLE "MemberAccount" ADD CONSTRAINT "MemberAccount_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberAccount" ADD CONSTRAINT "MemberAccount_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberAccount" ADD CONSTRAINT "MemberAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberAppInvite" ADD CONSTRAINT "MemberAppInvite_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberAppInvite" ADD CONSTRAINT "MemberAppInvite_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberAppInvite" ADD CONSTRAINT "MemberAppInvite_gymId_createdById_fkey" FOREIGN KEY ("gymId", "createdById") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginOtp" ADD CONSTRAINT "LoginOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDeviceSession" ADD CONSTRAINT "MobileDeviceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileRefreshToken" ADD CONSTRAINT "MobileRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MobileDeviceSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════ Security layer ═══════════════════════════════

-- A login needs an email or a phone (members may be phone-only).
ALTER TABLE "User" ADD CONSTRAINT "User_has_identifier" CHECK (email IS NOT NULL OR "phoneBlindIndex" IS NOT NULL);
ALTER TABLE "User" ADD CONSTRAINT "User_phone_pair" CHECK (("phoneEnc" IS NULL) = ("phoneBlindIndex" IS NULL));

-- An invite is bound to exactly one identity.
ALTER TABLE "MemberAppInvite"
  ADD CONSTRAINT "MemberAppInvite_one_identity"
    CHECK ((email IS NOT NULL) <> ("phoneBlindIndex" IS NOT NULL) AND ("phoneEnc" IS NULL) = ("phoneBlindIndex" IS NULL)),
  ADD CONSTRAINT "MemberAppInvite_email_lowercase" CHECK (email IS NULL OR email = lower(email));

-- ─────────────── Tenant tables: MemberAccount, MemberAppInvite ───────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MemberAccount', 'MemberAppInvite'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING ("gymId" = app_current_gym_id() AND (SELECT app_can_access_current_gym()))', t);
    EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym()))', t);
    EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE USING ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())) WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym()))', t);
    EXECUTE format('CREATE POLICY tenant_delete ON %I FOR DELETE USING ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym()))', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_gym_change()', t || '_gym_immutable', t);
  END LOOP;
END $$;

-- A user can list their own member accounts (gym picker), before a gym is selected.
CREATE POLICY own_member_accounts ON "MemberAccount" FOR SELECT USING ("userId" = app_current_user_id());

-- Members belong to a gym too (gym name/branding, subscription state), alongside staff.
CREATE OR REPLACE FUNCTION app_user_belongs_to_gym(p_gym_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "StaffMember" s
                 WHERE s."gymId" = p_gym_id AND s."userId" = app_current_user_id() AND s.status = 'ACTIVE')
      OR EXISTS (SELECT 1 FROM "MemberAccount" a JOIN "Member" m ON m.id = a."memberId"
                 WHERE a."gymId" = p_gym_id AND a."userId" = app_current_user_id() AND a.status = 'ACTIVE' AND m."deletedAt" IS NULL)
$$;

-- The member the current request acts as. The setting alone grants nothing: it must match an
-- ACTIVE account of the current user in the current gym, for a member who isn't deleted.
CREATE FUNCTION app_current_member_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT a."memberId" FROM "MemberAccount" a JOIN "Member" m ON m.id = a."memberId"
   WHERE a."memberId" = NULLIF(current_setting('app.current_member_id', true), '')
     AND a."userId" = app_current_user_id()
     AND a."gymId" = app_current_gym_id()
     AND a.status = 'ACTIVE' AND m."deletedAt" IS NULL
$$;

-- A member reads their own member record (more member-scoped policies arrive with each feature).
CREATE POLICY member_self_read ON "Member" FOR SELECT
  USING ("gymId" = app_current_gym_id() AND id = (SELECT app_current_member_id()));

-- ─────────────── Device sessions (platform, per user) ───────────────
ALTER TABLE "MobileDeviceSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MobileDeviceSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_device_sessions_read ON "MobileDeviceSession" FOR SELECT USING ("userId" = app_current_user_id());
CREATE POLICY own_device_sessions_update ON "MobileDeviceSession" FOR UPDATE
  USING ("userId" = app_current_user_id()) WITH CHECK ("userId" = app_current_user_id());

-- A revoked session stays revoked, and its identity fields never change.
CREATE FUNCTION mobile_session_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
    RAISE EXCEPTION 'device session already revoked' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW."userId", NEW."sessionVersion", NEW."createdAt") IS DISTINCT FROM (OLD."userId", OLD."sessionVersion", OLD."createdAt") THEN
    RAISE EXCEPTION 'device session identity cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "MobileDeviceSession_guard" BEFORE UPDATE ON "MobileDeviceSession" FOR EACH ROW EXECUTE FUNCTION mobile_session_guard();

-- Refresh tokens and one-time codes: no table access for the app at all (RLS on, no policies);
-- only the functions below touch them.
ALTER TABLE "MobileRefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MobileRefreshToken" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LoginOtp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoginOtp" FORCE ROW LEVEL SECURITY;

-- Start a device session for the current user (after the app verified their credentials).
CREATE FUNCTION mobile_session_start(p_device_name text, p_platform text, p_app_version text, p_ip text,
                                     p_token_hash text, p_token_expires timestamptz)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_user "User"%ROWTYPE;
  v_session_id text := gen_random_uuid()::text;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_user FROM "User" WHERE id = app_current_user_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'mobile:no_user' USING ERRCODE = 'P0001'; END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'mobile:bad_token' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO "MobileDeviceSession" (id, "userId", "deviceName", platform, "appVersion", ip, "sessionVersion", "lastSeenAt", "createdAt", "updatedAt")
  VALUES (v_session_id, v_user.id, left(p_device_name, 100), left(p_platform, 20), left(p_app_version, 40), left(p_ip, 64),
          v_user."sessionVersion", v_now, v_now, v_now);
  INSERT INTO "MobileRefreshToken" (id, "sessionId", "tokenHash", "expiresAt", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_session_id, p_token_hash, p_token_expires, v_now, v_now);
  RETURN v_session_id;
END $$;

-- Rotate a refresh token. Returns a status instead of raising, so revoking the whole session on
-- reuse commits: 'ok' | 'reused' | 'revoked' | 'expired' | 'invalid'.
CREATE FUNCTION mobile_refresh_rotate(p_old_hash text, p_new_hash text, p_new_expires timestamptz, p_max_session_days integer)
RETURNS TABLE (status text, user_id text, session_id text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_tok "MobileRefreshToken"%ROWTYPE;
  v_ses "MobileDeviceSession"%ROWTYPE;
  v_sv integer;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_tok FROM "MobileRefreshToken" WHERE "tokenHash" = p_old_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text; RETURN; END IF;
  SELECT * INTO v_ses FROM "MobileDeviceSession" WHERE id = v_tok."sessionId" FOR UPDATE;
  SELECT "sessionVersion" INTO v_sv FROM "User" WHERE id = v_ses."userId";

  IF v_ses."revokedAt" IS NOT NULL THEN
    RETURN QUERY SELECT 'revoked'::text, v_ses."userId", v_ses.id; RETURN;
  END IF;
  IF v_tok."usedAt" IS NOT NULL THEN
    -- An already-rotated token came back: someone else holds a copy. End the whole session.
    UPDATE "MobileDeviceSession" SET "revokedAt" = v_now, "revokeReason" = 'refresh_reuse', "updatedAt" = v_now WHERE id = v_ses.id;
    RETURN QUERY SELECT 'reused'::text, v_ses."userId", v_ses.id; RETURN;
  END IF;
  IF v_sv IS DISTINCT FROM v_ses."sessionVersion" THEN
    UPDATE "MobileDeviceSession" SET "revokedAt" = v_now, "revokeReason" = 'signed_out_everywhere', "updatedAt" = v_now WHERE id = v_ses.id;
    RETURN QUERY SELECT 'revoked'::text, v_ses."userId", v_ses.id; RETURN;
  END IF;
  IF v_tok."expiresAt" <= v_now OR v_ses."createdAt" <= v_now - make_interval(days => p_max_session_days) THEN
    RETURN QUERY SELECT 'expired'::text, v_ses."userId", v_ses.id; RETURN;
  END IF;
  IF p_new_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'mobile:bad_token' USING ERRCODE = 'P0001'; END IF;

  UPDATE "MobileRefreshToken" SET "usedAt" = v_now, "updatedAt" = v_now WHERE id = v_tok.id;
  INSERT INTO "MobileRefreshToken" (id, "sessionId", "tokenHash", "expiresAt", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_ses.id, p_new_hash, p_new_expires, v_now, v_now);
  UPDATE "MobileDeviceSession" SET "lastSeenAt" = v_now, "updatedAt" = v_now WHERE id = v_ses.id;
  RETURN QUERY SELECT 'ok'::text, v_ses."userId", v_ses.id;
END $$;

-- ─────────────── One-time login codes ───────────────
CREATE FUNCTION otp_issue(p_user_id text, p_identifier_hash text, p_code_hash text, p_ttl_seconds integer)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE v_now timestamptz := now();
BEGIN
  -- A new code replaces any earlier unused one for the same identifier.
  UPDATE "LoginOtp" SET "usedAt" = v_now, "updatedAt" = v_now
   WHERE "identifierHash" = p_identifier_hash AND "usedAt" IS NULL;
  INSERT INTO "LoginOtp" (id, "userId", "identifierHash", "codeHash", "expiresAt", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, p_user_id, p_identifier_hash, p_code_hash, v_now + make_interval(secs => p_ttl_seconds), v_now, v_now);
END $$;

-- 'ok' (with user_id) | 'invalid' | 'locked'. Wrong guesses count against the code; at the limit
-- the code is burnt.
CREATE FUNCTION otp_verify(p_identifier_hash text, p_code_hash text, p_max_attempts integer)
RETURNS TABLE (status text, user_id text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_otp "LoginOtp"%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_otp FROM "LoginOtp"
   WHERE "identifierHash" = p_identifier_hash AND "usedAt" IS NULL AND "expiresAt" > v_now
   ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid'::text, NULL::text; RETURN; END IF;
  IF v_otp."codeHash" <> p_code_hash THEN
    UPDATE "LoginOtp"
       SET attempts = attempts + 1,
           "usedAt" = CASE WHEN attempts + 1 >= p_max_attempts THEN v_now END,
           "updatedAt" = v_now
     WHERE id = v_otp.id;
    RETURN QUERY SELECT (CASE WHEN v_otp.attempts + 1 >= p_max_attempts THEN 'locked' ELSE 'invalid' END)::text, NULL::text;
    RETURN;
  END IF;
  UPDATE "LoginOtp" SET "usedAt" = v_now, "updatedAt" = v_now WHERE id = v_otp.id;
  RETURN QUERY SELECT 'ok'::text, v_otp."userId";
END $$;

-- Login lookup by phone (platform blind index), like auth_lookup_user for email.
CREATE FUNCTION auth_lookup_user_by_phone(p_blind text)
RETURNS TABLE (id text, name text, "passwordHash" text, "sessionVersion" integer, "isSuperAdmin" boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT u.id, u.name, u."passwordHash", u."sessionVersion", u."isSuperAdmin" FROM "User" u WHERE u."phoneBlindIndex" = p_blind
$$;

-- ─────────────── Member app invites ───────────────
CREATE FUNCTION member_invite_lookup(p_token_hash text)
RETURNS TABLE (state text, gym_id text, gym_slug text, gym_name text, brand_color text, first_name text,
               channel text, email text, phone_blind text, existing_user_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT CASE WHEN i."revokedAt" IS NOT NULL OR m."deletedAt" IS NOT NULL THEN 'revoked'
              WHEN i."usedAt" IS NOT NULL THEN 'used'
              WHEN i."expiresAt" <= now() THEN 'expired'
              ELSE 'valid' END,
         g.id, g.slug, g.name, g."brandColor", m."firstName", i.channel::text, i.email, i."phoneBlindIndex",
         (SELECT u.id FROM "User" u
           WHERE (i.email IS NOT NULL AND u.email = i.email)
              OR (i."phoneBlindIndex" IS NOT NULL AND u."phoneBlindIndex" = i."phoneBlindIndex") LIMIT 1)
    FROM "MemberAppInvite" i JOIN "Gym" g ON g.id = i."gymId" JOIN "Member" m ON m.id = i."memberId"
   WHERE i."tokenHash" = p_token_hash
$$;

-- Redeem an invite: link an existing login (whose password the app has verified) or create one
-- bound to exactly the invited email/phone. Single use, row-locked, audited in the gym.
CREATE FUNCTION member_invite_redeem(p_token_hash text, p_existing_user_id text, p_new_user_id text, p_name text,
                                     p_phone_enc text, p_password_hash text)
RETURNS TABLE (user_id text, gym_id text, gym_slug text, member_id text, created_user boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_inv "MemberAppInvite"%ROWTYPE;
  v_member "Member"%ROWTYPE;
  v_user_id text;
  v_created boolean := false;
  v_now timestamptz := now();
  v_slug text;
BEGIN
  SELECT * INTO v_inv FROM "MemberAppInvite" WHERE "tokenHash" = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'member_invite:not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_inv."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'member_invite:revoked' USING ERRCODE = 'P0001'; END IF;
  IF v_inv."usedAt" IS NOT NULL THEN RAISE EXCEPTION 'member_invite:used' USING ERRCODE = 'P0001'; END IF;
  IF v_inv."expiresAt" <= v_now THEN RAISE EXCEPTION 'member_invite:expired' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_member FROM "Member" WHERE id = v_inv."memberId" FOR UPDATE;
  IF v_member."deletedAt" IS NOT NULL THEN RAISE EXCEPTION 'member_invite:revoked' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM "MemberAccount" WHERE "memberId" = v_member.id) THEN
    RAISE EXCEPTION 'member_invite:already_linked' USING ERRCODE = 'P0001';
  END IF;

  IF p_existing_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = p_existing_user_id
                     AND ((v_inv.email IS NOT NULL AND u.email = v_inv.email)
                       OR (v_inv."phoneBlindIndex" IS NOT NULL AND u."phoneBlindIndex" = v_inv."phoneBlindIndex"))) THEN
      RAISE EXCEPTION 'member_invite:identity_mismatch' USING ERRCODE = 'P0001';
    END IF;
    v_user_id := p_existing_user_id;
  ELSE
    IF EXISTS (SELECT 1 FROM "User" u WHERE (v_inv.email IS NOT NULL AND u.email = v_inv.email)
                                        OR (v_inv."phoneBlindIndex" IS NOT NULL AND u."phoneBlindIndex" = v_inv."phoneBlindIndex")) THEN
      RAISE EXCEPTION 'member_invite:account_exists' USING ERRCODE = 'P0001';
    END IF;
    IF p_new_user_id IS NULL OR coalesce(length(btrim(p_name)), 0) < 2
       OR p_password_hash IS NULL OR p_password_hash NOT LIKE '$argon2id$%'
       OR (v_inv."phoneBlindIndex" IS NULL) <> (p_phone_enc IS NULL) THEN
      RAISE EXCEPTION 'member_invite:missing_account_details' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO "User" (id, email, "phoneEnc", "phoneBlindIndex", name, "passwordHash", "createdAt", "updatedAt")
    VALUES (p_new_user_id, v_inv.email, p_phone_enc, v_inv."phoneBlindIndex", left(btrim(p_name), 80), p_password_hash, v_now, v_now);
    v_user_id := p_new_user_id;
    v_created := true;
  END IF;

  IF EXISTS (SELECT 1 FROM "MemberAccount" WHERE "gymId" = v_inv."gymId" AND "userId" = v_user_id) THEN
    RAISE EXCEPTION 'member_invite:already_member' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO "MemberAccount" (id, "gymId", "memberId", "userId", status, "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_inv."gymId", v_member.id, v_user_id, 'ACTIVE', v_now, v_now);
  UPDATE "MemberAppInvite" SET "usedAt" = v_now, "updatedAt" = v_now WHERE id = v_inv.id;
  UPDATE "MemberAppInvite" SET "revokedAt" = v_now, "updatedAt" = v_now
   WHERE "memberId" = v_member.id AND id <> v_inv.id AND "usedAt" IS NULL AND "revokedAt" IS NULL;
  INSERT INTO "AuditLog" (id, "gymId", "actorUserId", "actorType", action, "entityType", "entityId", changes, "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_inv."gymId", v_user_id, 'USER', 'member.app_invite_accepted', 'Member', v_member.id,
          jsonb_build_object('channel', v_inv.channel::text, 'inviteId', v_inv.id, 'newAccount', v_created), v_now, v_now);

  SELECT slug INTO v_slug FROM "Gym" WHERE id = v_inv."gymId";
  RETURN QUERY SELECT v_user_id, v_inv."gymId", v_slug, v_member.id, v_created;
END $$;

REVOKE ALL ON FUNCTION app_current_member_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION mobile_session_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION mobile_session_start(text, text, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION mobile_refresh_rotate(text, text, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION otp_issue(text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION otp_verify(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_lookup_user_by_phone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION member_invite_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION member_invite_redeem(text, text, text, text, text, text) FROM PUBLIC;

