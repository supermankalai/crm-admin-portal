-- Security layer: CHECK constraints, integrity triggers, append-only audit tables,
-- Row-Level Security policies, and narrow SECURITY DEFINER functions.
--
-- Prisma does not manage CHECK constraints, triggers, functions or policies, so later
-- `prisma migrate dev` runs will not try to drop anything defined here.
-- Grants for the restricted app role live in prisma/sql/002_grants.sql because they
-- depend on the role existing (npm run db:grants).

-- ───────────────────────────── CHECK constraints ─────────────────────────────

ALTER TABLE "User"
  ADD CONSTRAINT "User_email_lowercase" CHECK (email = lower(email) AND position('@' in email) > 1);

ALTER TABLE "PlatformPlan"
  ADD CONSTRAINT "PlatformPlan_values" CHECK (
    "priceMonthlyMinor" >= 0 AND "maxMembers" > 0 AND "maxStaff" > 0 AND "maxLocations" > 0);

ALTER TABLE "Gym"
  ADD CONSTRAINT "Gym_slug_format" CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  ADD CONSTRAINT "Gym_tax_rate" CHECK ("taxRateBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "Gym_brand_color" CHECK ("brandColor" ~ '^#[0-9a-fA-F]{6}$'),
  ADD CONSTRAINT "Gym_currency" CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE "GymSubscription"
  ADD CONSTRAINT "GymSubscription_period" CHECK ("currentPeriodEnd" > "currentPeriodStart");

ALTER TABLE "MembershipPlan"
  ADD CONSTRAINT "MembershipPlan_values" CHECK (
    "priceMinor" >= 0 AND "durationDays" > 0 AND ("classCredits" IS NULL OR "classCredits" > 0)
    AND "maxFreezeDays" >= 0 AND "cancellationNoticeDays" >= 0 AND "cancellationFeeMinor" >= 0),
  ADD CONSTRAINT "MembershipPlan_class_pack_credits" CHECK (("type" = 'CLASS_PACK') = ("classCredits" IS NOT NULL));

ALTER TABLE "Member"
  ADD CONSTRAINT "Member_number_positive" CHECK ("memberNumber" > 0);

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_dates" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "Membership_values" CHECK ("priceMinor" >= 0 AND ("classCreditsRemaining" IS NULL OR "classCreditsRemaining" >= 0));

ALTER TABLE "MembershipFreeze"
  ADD CONSTRAINT "MembershipFreeze_dates" CHECK ("endDate" >= "startDate");

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_amounts" CHECK (
    "subtotalMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" = "subtotalMinor" + "taxMinor"
    AND "amountPaidMinor" >= 0 AND "amountPaidMinor" <= "totalMinor"),
  ADD CONSTRAINT "Invoice_number_positive" CHECK ("number" > 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountMinor" > 0);

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_amount_positive" CHECK ("amountMinor" > 0);

ALTER TABLE "Room"
  ADD CONSTRAINT "Room_capacity_positive" CHECK (capacity > 0);

ALTER TABLE "ClassType"
  ADD CONSTRAINT "ClassType_values" CHECK ("durationMinutes" > 0 AND "defaultCapacity" > 0);

ALTER TABLE "ClassSession"
  ADD CONSTRAINT "ClassSession_times" CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "ClassSession_capacity_positive" CHECK (capacity > 0);

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_waitlist_position" CHECK ((status = 'WAITLISTED') = ("waitlistPosition" IS NOT NULL));

ALTER TABLE "OpeningHours"
  ADD CONSTRAINT "OpeningHours_values" CHECK (
    "dayOfWeek" BETWEEN 0 AND 6 AND "openMinute" BETWEEN 0 AND 1440 AND "closeMinute" BETWEEN 0 AND 1440
    AND ("isClosed" OR "closeMinute" > "openMinute"));

ALTER TABLE "StaffShift"
  ADD CONSTRAINT "StaffShift_times" CHECK ("endsAt" > "startsAt");

ALTER TABLE "GymCounter"
  ADD CONSTRAINT "GymCounter_value" CHECK (value >= 0);

-- ──────────────── "Unique among non-deleted rows" key maintenance ────────────────

CREATE FUNCTION member_set_email_key() RETURNS trigger
LANGUAGE plpgsql SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  NEW."emailKey" := CASE WHEN NEW."deletedAt" IS NULL AND NEW.email IS NOT NULL THEN lower(NEW.email) END;
  RETURN NEW;
END $$;

CREATE TRIGGER "Member_email_key" BEFORE INSERT OR UPDATE ON "Member"
  FOR EACH ROW EXECUTE FUNCTION member_set_email_key();

CREATE FUNCTION plan_set_name_key() RETURNS trigger
LANGUAGE plpgsql SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  NEW."nameKey" := CASE WHEN NEW."deletedAt" IS NULL THEN lower(btrim(NEW.name)) END;
  RETURN NEW;
END $$;

CREATE TRIGGER "MembershipPlan_name_key" BEFORE INSERT OR UPDATE ON "MembershipPlan"
  FOR EACH ROW EXECUTE FUNCTION plan_set_name_key();

-- A row's tenant can never change.
CREATE FUNCTION forbid_gym_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  IF NEW."gymId" IS DISTINCT FROM OLD."gymId" THEN
    RAISE EXCEPTION 'gymId of % cannot be changed', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ───────────────────────────── Append-only tables ─────────────────────────────

CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "PlatformAuditLog_append_only" BEFORE UPDATE OR DELETE ON "PlatformAuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "SubscriptionHistory_append_only" BEFORE UPDATE OR DELETE ON "SubscriptionHistory"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ─────────────────────────── RLS context helpers ───────────────────────────
-- The app sets these with set_config(name, value, true) (= SET LOCAL) at the start of every
-- transaction. Missing settings resolve to NULL, which matches no rows.

CREATE FUNCTION app_current_gym_id() RETURNS text
LANGUAGE sql STABLE SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT NULLIF(current_setting('app.current_gym_id', true), '')
$$;

CREATE FUNCTION app_current_user_id() RETURNS text
LANGUAGE sql STABLE SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')
$$;

CREATE FUNCTION app_current_support_session_id() RETURNS text
LANGUAGE sql STABLE SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT NULLIF(current_setting('app.support_session_id', true), '')
$$;

-- SECURITY DEFINER helpers read tables without re-entering RLS (avoids policy recursion).
-- They only ever answer questions about the *current* session's user and gym.

CREATE FUNCTION app_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT coalesce(current_setting('app.platform_admin', true), '') = 'on'
     AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = app_current_user_id() AND u."isSuperAdmin")
$$;

-- Active staff of the current gym (used for writes).
CREATE FUNCTION app_is_staff_of_current_gym() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT app_current_gym_id() IS NOT NULL AND app_current_user_id() IS NOT NULL
     AND EXISTS (SELECT 1 FROM "StaffMember" s
                 WHERE s."gymId" = app_current_gym_id()
                   AND s."userId" = app_current_user_id()
                   AND s.status = 'ACTIVE')
$$;

-- Active staff OR a super admin with a live, unexpired support session for this gym (reads).
CREATE FUNCTION app_can_access_current_gym() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT app_is_staff_of_current_gym()
      OR (app_current_gym_id() IS NOT NULL AND app_current_user_id() IS NOT NULL
          AND EXISTS (SELECT 1 FROM "SupportAccessSession" x
                      JOIN "User" u ON u.id = x."superAdminId" AND u."isSuperAdmin"
                      WHERE x.id = app_current_support_session_id()
                        AND x."gymId" = app_current_gym_id()
                        AND x."superAdminId" = app_current_user_id()
                        AND x."endedAt" IS NULL
                        AND x."expiresAt" > now()))
$$;

CREATE FUNCTION app_is_owner_of_current_gym() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "StaffMember" s
                 WHERE s."gymId" = app_current_gym_id()
                   AND s."userId" = app_current_user_id()
                   AND s.status = 'ACTIVE' AND s.role = 'OWNER')
$$;

-- Is the current user active staff of the given gym? (gym switcher / Gym row visibility)
CREATE FUNCTION app_user_belongs_to_gym(p_gym_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "StaffMember" s
                 WHERE s."gymId" = p_gym_id
                   AND s."userId" = app_current_user_id()
                   AND s.status = 'ACTIVE')
$$;

-- Does the given user work in the current gym? (lets staff see colleagues' names)
CREATE FUNCTION app_user_in_current_gym(p_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT (SELECT app_can_access_current_gym())
     AND EXISTS (SELECT 1 FROM "StaffMember" s
                 WHERE s."gymId" = app_current_gym_id() AND s."userId" = p_user_id)
$$;

-- ─────────────────────────── Tenant table policies ───────────────────────────
-- Reads: staff of the gym, or an active support session.
-- Writes: active staff of the gym only (support access is read-only at the DB level).

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'StaffMember', 'StaffInvitation', 'StaffShift', 'TrainerClient', 'Location', 'OpeningHours',
    'GymCounter', 'MembershipPlan', 'Member', 'MemberNote', 'Membership', 'MembershipFreeze',
    'Invoice', 'Payment', 'Refund', 'CheckIn', 'Room', 'ClassType', 'ClassSession', 'Booking',
    'Notification', 'FileAsset', 'AuditLog', 'SubscriptionHistory'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_read ON %I FOR SELECT
         USING ("gymId" = app_current_gym_id() AND (SELECT app_can_access_current_gym()))', t);
    IF t NOT IN ('AuditLog', 'SubscriptionHistory') THEN
      EXECUTE format(
        'CREATE POLICY tenant_insert ON %I FOR INSERT
           WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym()))', t);
      EXECUTE format(
        'CREATE POLICY tenant_update ON %I FOR UPDATE
           USING ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym()))
           WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym()))', t);
      EXECUTE format(
        'CREATE POLICY tenant_delete ON %I FOR DELETE
           USING ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym()))', t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_gym_change()',
        t || '_gym_immutable', t);
    END IF;
  END LOOP;
END $$;

-- Audit entries may also be written during (read-only) support access, recording what was viewed.
CREATE POLICY tenant_insert ON "AuditLog" FOR INSERT
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_can_access_current_gym()));

-- A user can always list their own staff rows (gym switcher), before a gym is selected.
CREATE POLICY own_staff_rows ON "StaffMember" FOR SELECT
  USING ("userId" = app_current_user_id());

-- Subscription history: gym can read its own (tenant_read above); platform admin reads/appends all.
CREATE POLICY platform_admin_read ON "SubscriptionHistory" FOR SELECT USING ((SELECT app_is_platform_admin()));
CREATE POLICY platform_admin_insert ON "SubscriptionHistory" FOR INSERT WITH CHECK ((SELECT app_is_platform_admin()));

-- ────────────────────────── Platform table policies ──────────────────────────

ALTER TABLE "Gym" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Gym" FORCE ROW LEVEL SECURITY;
CREATE POLICY gym_read ON "Gym" FOR SELECT USING (
  (id = app_current_gym_id() AND (SELECT app_can_access_current_gym()))
  OR app_user_belongs_to_gym(id)
  OR (SELECT app_is_platform_admin()));
CREATE POLICY gym_owner_update ON "Gym" FOR UPDATE
  USING (id = app_current_gym_id() AND (SELECT app_is_owner_of_current_gym()))
  WITH CHECK (id = app_current_gym_id() AND (SELECT app_is_owner_of_current_gym()));
CREATE POLICY gym_admin_insert ON "Gym" FOR INSERT WITH CHECK ((SELECT app_is_platform_admin()));
CREATE POLICY gym_admin_update ON "Gym" FOR UPDATE
  USING ((SELECT app_is_platform_admin())) WITH CHECK ((SELECT app_is_platform_admin()));

ALTER TABLE "GymSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GymSubscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_read ON "GymSubscription" FOR SELECT USING (
  ("gymId" = app_current_gym_id() AND (SELECT app_can_access_current_gym()))
  OR app_user_belongs_to_gym("gymId")
  OR (SELECT app_is_platform_admin()));
CREATE POLICY subscription_admin_insert ON "GymSubscription" FOR INSERT WITH CHECK ((SELECT app_is_platform_admin()));
CREATE POLICY subscription_admin_update ON "GymSubscription" FOR UPDATE
  USING ((SELECT app_is_platform_admin())) WITH CHECK ((SELECT app_is_platform_admin()));

ALTER TABLE "PlatformPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_public_read ON "PlatformPlan" FOR SELECT USING (true);
CREATE POLICY plan_admin_insert ON "PlatformPlan" FOR INSERT WITH CHECK ((SELECT app_is_platform_admin()));
CREATE POLICY plan_admin_update ON "PlatformPlan" FOR UPDATE
  USING ((SELECT app_is_platform_admin())) WITH CHECK ((SELECT app_is_platform_admin()));

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY user_read ON "User" FOR SELECT USING (
  id = app_current_user_id()
  OR app_user_in_current_gym(id)
  OR (SELECT app_is_platform_admin()));
CREATE POLICY user_self_update ON "User" FOR UPDATE
  USING (id = app_current_user_id()) WITH CHECK (id = app_current_user_id());
CREATE POLICY user_admin_insert ON "User" FOR INSERT WITH CHECK ((SELECT app_is_platform_admin()));
CREATE POLICY user_admin_update ON "User" FOR UPDATE
  USING ((SELECT app_is_platform_admin())) WITH CHECK ((SELECT app_is_platform_admin()));

-- Super admins may not elevate themselves or others via a plain UPDATE: isSuperAdmin is
-- changed only by the owner role (seed / ops script).
CREATE FUNCTION forbid_super_admin_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  IF NEW."isSuperAdmin" IS DISTINCT FROM OLD."isSuperAdmin"
     AND NOT (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'isSuperAdmin can only be changed by the database owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_super_admin_guard" BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION forbid_super_admin_change();

ALTER TABLE "SupportAccessSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportAccessSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY support_admin_all ON "SupportAccessSession" FOR ALL
  USING ((SELECT app_is_platform_admin()))
  WITH CHECK ((SELECT app_is_platform_admin()) AND "superAdminId" = app_current_user_id());
-- The super admin's own support session must be readable while acting inside the gym.
CREATE POLICY support_self_read ON "SupportAccessSession" FOR SELECT
  USING ("superAdminId" = app_current_user_id() AND id = app_current_support_session_id());

ALTER TABLE "PlatformAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformAuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_audit_insert ON "PlatformAuditLog" FOR INSERT WITH CHECK (true);
CREATE POLICY platform_audit_admin_read ON "PlatformAuditLog" FOR SELECT USING ((SELECT app_is_platform_admin()));

-- No policies at all: invisible to the app role except via the functions below.
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RateLimitBucket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateLimitBucket" FORCE ROW LEVEL SECURITY;

-- ─────────────────────── Pre-authentication functions ───────────────────────

-- Login: returns only what is needed to verify a password. Called before any user context exists.
CREATE FUNCTION auth_lookup_user(p_email text)
RETURNS TABLE (id text, name text, "passwordHash" text, "sessionVersion" integer, "isSuperAdmin" boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT u.id, u.name, u."passwordHash", u."sessionVersion", u."isSuperAdmin"
  FROM "User" u WHERE u.email = lower(btrim(p_email))
$$;

-- Fixed-window rate limiter. Returns whether this hit is allowed and seconds until reset.
CREATE FUNCTION rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
RETURNS TABLE (allowed boolean, remaining integer, retry_after_seconds integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_count integer;
  v_start timestamp(3);
  v_window interval := make_interval(secs => p_window_seconds);
BEGIN
  INSERT INTO "RateLimitBucket" (key, count, "windowStart", "createdAt", "updatedAt")
  VALUES (p_key, 1, now(), now(), now())
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN "RateLimitBucket"."windowStart" <= now() - v_window THEN 1
                 ELSE "RateLimitBucket".count + 1 END,
    "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" <= now() - v_window THEN now()
                         ELSE "RateLimitBucket"."windowStart" END,
    "updatedAt" = now()
  RETURNING "RateLimitBucket".count, "RateLimitBucket"."windowStart" INTO v_count, v_start;

  RETURN QUERY SELECT
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    greatest(ceil(extract(epoch FROM (v_start + v_window - now())))::integer, 0);
END $$;

CREATE FUNCTION rate_limit_reset(p_key text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  DELETE FROM "RateLimitBucket" WHERE key = p_key
$$;

-- Nothing is executable by PUBLIC; db:grants grants EXECUTE to the app role explicitly.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "gym-admin-portal" FROM PUBLIC;
REVOKE ALL ON SCHEMA "gym-admin-portal" FROM PUBLIC;
