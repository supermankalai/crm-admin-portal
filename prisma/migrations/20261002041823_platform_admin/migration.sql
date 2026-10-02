-- Phase 3: plan limits enforced in the database, platform analytics (aggregates only),
-- and the subscription expiry job.

-- ───────────────────────────── Plan limits ─────────────────────────────
-- Defence in depth for maxMembers / maxStaff / maxLocations. The app checks first to show a
-- friendly upgrade message; this trigger guarantees the limit even under concurrent inserts
-- (a per-gym advisory lock serialises the count-then-insert). Existing rows are never removed
-- when a gym downgrades — only new rows beyond the limit are refused.

CREATE FUNCTION enforce_plan_limits() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_limit integer;
  v_count integer;
  v_kind text;
BEGIN
  -- Only rows that start counting toward a limit are checked.
  IF TG_TABLE_NAME = 'Member' THEN
    IF NEW."deletedAt" IS NOT NULL OR (TG_OP = 'UPDATE' AND OLD."deletedAt" IS NULL) THEN RETURN NEW; END IF;
    v_kind := 'members';
  ELSIF TG_TABLE_NAME = 'StaffMember' THEN
    IF NEW.status <> 'ACTIVE' OR (TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE') THEN RETURN NEW; END IF;
    v_kind := 'staff';
  ELSIF TG_TABLE_NAME = 'Location' THEN
    IF NOT NEW."isActive" OR (TG_OP = 'UPDATE' AND OLD."isActive") THEN RETURN NEW; END IF;
    v_kind := 'locations';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('plan_limit:' || NEW."gymId" || ':' || v_kind));

  SELECT CASE v_kind WHEN 'members' THEN p."maxMembers" WHEN 'staff' THEN p."maxStaff" ELSE p."maxLocations" END
    INTO v_limit
    FROM "GymSubscription" s JOIN "PlatformPlan" p ON p.id = s."planId"
   WHERE s."gymId" = NEW."gymId";
  IF v_limit IS NULL THEN
    RETURN NEW; -- no subscription yet (inside sign-up, before the trial row exists)
  END IF;

  IF v_kind = 'members' THEN
    SELECT count(*) INTO v_count FROM "Member" WHERE "gymId" = NEW."gymId" AND "deletedAt" IS NULL AND id <> NEW.id;
  ELSIF v_kind = 'staff' THEN
    SELECT count(*) INTO v_count FROM "StaffMember" WHERE "gymId" = NEW."gymId" AND status = 'ACTIVE' AND id <> NEW.id;
  ELSE
    SELECT count(*) INTO v_count FROM "Location" WHERE "gymId" = NEW."gymId" AND "isActive" AND id <> NEW.id;
  END IF;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'plan_limit:%', v_kind USING ERRCODE = 'P0001', DETAIL = format('limit=%s', v_limit);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Member_plan_limit" BEFORE INSERT OR UPDATE OF "deletedAt" ON "Member"
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_limits();
CREATE TRIGGER "StaffMember_plan_limit" BEFORE INSERT OR UPDATE OF status ON "StaffMember"
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_limits();
CREATE TRIGGER "Location_plan_limit" BEFORE INSERT OR UPDATE OF "isActive" ON "Location"
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_limits();

-- ─────────────────────── Platform analytics (aggregates only) ───────────────────────
-- Super admins never read tenant rows directly. These functions return counts and sums,
-- and refuse to run unless the caller is a verified platform admin.

CREATE FUNCTION assert_platform_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  IF NOT app_is_platform_admin() THEN
    RAISE EXCEPTION 'platform admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

CREATE FUNCTION platform_stats() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM assert_platform_admin();
  SELECT jsonb_build_object(
    'gymsByStatus', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                       FROM (SELECT status::text, count(*) n FROM "Gym" GROUP BY status) x),
    'gymsByPlan', (SELECT coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'count', coalesce(c.n, 0)) ORDER BY p."sortOrder"), '[]'::jsonb)
                     FROM "PlatformPlan" p
                     LEFT JOIN (SELECT "planId", count(*) n FROM "GymSubscription" GROUP BY "planId") c ON c."planId" = p.id),
    'mrrMinor', (SELECT coalesce(sum(p."priceMonthlyMinor"), 0)
                   FROM "GymSubscription" s
                   JOIN "PlatformPlan" p ON p.id = s."planId"
                   JOIN "Gym" g ON g.id = s."gymId"
                  WHERE s.status = 'ACTIVE' AND g.status = 'ACTIVE' AND s."currentPeriodEnd" > now()),
    'trialsEndingSoon', (SELECT count(*) FROM "GymSubscription" s
                          WHERE s.status = 'TRIALING' AND s."trialEndsAt" BETWEEN now() AND now() + interval '7 days'),
    'totalMembers', (SELECT count(*) FROM "Member" WHERE "deletedAt" IS NULL),
    'activeMemberships', (SELECT count(*) FROM "Membership" WHERE status = 'ACTIVE' AND "endDate" >= current_date),
    'checkInsLast30Days', (SELECT count(*) FROM "CheckIn" WHERE result = 'ALLOWED' AND "checkedInAt" >= now() - interval '30 days'),
    'signupsByMonth', (SELECT coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'count', coalesce(c.n, 0)) ORDER BY m), '[]'::jsonb)
                         FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
                         LEFT JOIN (SELECT date_trunc('month', "createdAt") mm, count(*) n FROM "Gym" GROUP BY 1) c ON c.mm = m)
  ) INTO v_result;
  RETURN v_result;
END $$;

-- Per-gym usage counts for the admin gym list (no personal data).
CREATE FUNCTION platform_gym_usage()
RETURNS TABLE (gym_id text, members bigint, staff bigint, locations bigint, check_ins_30d bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  PERFORM assert_platform_admin();
  RETURN QUERY
  SELECT g.id,
         (SELECT count(*) FROM "Member" m WHERE m."gymId" = g.id AND m."deletedAt" IS NULL),
         (SELECT count(*) FROM "StaffMember" s WHERE s."gymId" = g.id AND s.status = 'ACTIVE'),
         (SELECT count(*) FROM "Location" l WHERE l."gymId" = g.id AND l."isActive"),
         (SELECT count(*) FROM "CheckIn" c WHERE c."gymId" = g.id AND c."checkedInAt" >= now() - interval '30 days')
  FROM "Gym" g;
END $$;

-- ─────────────────────────── Subscription expiry job ───────────────────────────
-- Marks trials/subscriptions whose period has ended as EXPIRED and records history.
-- Idempotent. Callable by a platform admin (admin pages) or the owner role (npm run jobs:run).
-- Read-only mode never depends on this job: it is also computed from dates per request.

CREATE FUNCTION expire_due_subscriptions() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT app_is_platform_admin()
     AND NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = session_user) THEN
    RAISE EXCEPTION 'platform admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH due AS (
    UPDATE "GymSubscription" s
       SET status = 'EXPIRED', "updatedAt" = now()
     WHERE s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE') AND s."currentPeriodEnd" <= now()
    RETURNING s."gymId", s."planId", s."currentPeriodEnd",
              (SELECT x.status FROM "GymSubscription" x WHERE x.id = s.id) AS old_status
  )
  INSERT INTO "SubscriptionHistory" (id, "gymId", action, "fromPlanId", "toPlanId", "fromStatus", "toStatus",
                                     "previousPeriodEnd", note, "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, d."gymId", 'EXPIRED', d."planId", d."planId", d.old_status, 'EXPIRED',
         d."currentPeriodEnd", 'Period ended (automatic)', now(), now()
    FROM due d;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION enforce_plan_limits(), assert_platform_admin(), platform_stats(),
  platform_gym_usage(), expire_due_subscriptions() FROM PUBLIC;
