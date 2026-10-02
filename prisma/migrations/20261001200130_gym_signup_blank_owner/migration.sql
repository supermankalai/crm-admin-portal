-- Treat blank owner fields as missing so callers get signup:missing_owner instead of a
-- CHECK-constraint error (defence in depth; the app validates first).

CREATE OR REPLACE FUNCTION signup_create_gym(
  p_slug text,
  p_name text,
  p_timezone text,
  p_currency text,
  p_plan_code text,
  p_new_user_email text,
  p_new_user_name text,
  p_new_user_password_hash text
) RETURNS TABLE (gym_id text, user_id text, trial_ends_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_user_id text := app_current_user_id();
  v_gym_id text := gen_random_uuid()::text;
  v_staff_id text := gen_random_uuid()::text;
  v_location_id text := gen_random_uuid()::text;
  v_plan_id text;
  v_now timestamptz := now();
  v_trial_end timestamptz := now() + interval '14 days';
  v_email text := NULLIF(lower(btrim(p_new_user_email)), '');
  v_name text := NULLIF(btrim(p_new_user_name), '');
BEGIN
  SELECT id INTO v_plan_id FROM "PlatformPlan" WHERE code = upper(btrim(p_plan_code)) AND "isActive";
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'signup:invalid_plan' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM "Gym" WHERE slug = p_slug) THEN
    RAISE EXCEPTION 'signup:slug_taken' USING ERRCODE = 'P0001';
  END IF;

  IF v_user_id IS NULL THEN
    IF v_email IS NULL OR v_name IS NULL OR p_new_user_password_hash IS NULL
       OR p_new_user_password_hash NOT LIKE '$argon2id$%' THEN
      RAISE EXCEPTION 'signup:missing_owner' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM "User" WHERE email = v_email) THEN
      RAISE EXCEPTION 'signup:email_taken' USING ERRCODE = 'P0001';
    END IF;
    v_user_id := gen_random_uuid()::text;
    INSERT INTO "User" (id, email, name, "passwordHash", "createdAt", "updatedAt")
    VALUES (v_user_id, v_email, v_name, p_new_user_password_hash, v_now, v_now);
  ELSIF NOT EXISTS (SELECT 1 FROM "User" WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'signup:unknown_user' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO "Gym" (id, slug, name, status, timezone, currency, "createdAt", "updatedAt")
  VALUES (v_gym_id, p_slug, btrim(p_name), 'TRIAL', p_timezone, p_currency, v_now, v_now);

  INSERT INTO "StaffMember" (id, "gymId", "userId", role, status, title, "createdAt", "updatedAt")
  VALUES (v_staff_id, v_gym_id, v_user_id, 'OWNER', 'ACTIVE', 'Owner', v_now, v_now);

  INSERT INTO "GymSubscription" (id, "gymId", "planId", status, "trialEndsAt", "currentPeriodStart",
                                 "currentPeriodEnd", provider, "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_gym_id, v_plan_id, 'TRIALING', v_trial_end, v_now, v_trial_end,
          'MANUAL', v_now, v_now);

  INSERT INTO "SubscriptionHistory" (id, "gymId", action, "toPlanId", "toStatus", "newPeriodEnd",
                                     "actorUserId", note, "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_gym_id, 'TRIAL_STARTED', v_plan_id, 'TRIALING', v_trial_end,
          v_user_id, 'Self-service sign-up', v_now, v_now);

  INSERT INTO "Location" (id, "gymId", name, "createdAt", "updatedAt")
  VALUES (v_location_id, v_gym_id, 'Main location', v_now, v_now);

  INSERT INTO "OpeningHours" (id, "gymId", "locationId", "dayOfWeek", "openMinute", "closeMinute",
                              "isClosed", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, v_gym_id, v_location_id, d,
         CASE WHEN d = 0 THEN 7 * 60 ELSE 6 * 60 END,
         CASE WHEN d = 0 THEN 13 * 60 ELSE 22 * 60 END,
         false, v_now, v_now
  FROM generate_series(0, 6) AS d;

  INSERT INTO "GymCounter" (id, "gymId", key, value, "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_gym_id, 'member', 0, v_now, v_now),
         (gen_random_uuid()::text, v_gym_id, 'invoice', 0, v_now, v_now);

  INSERT INTO "AuditLog" (id, "gymId", "actorUserId", "actorType", action, "entityType", "entityId",
                          changes, "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_gym_id, v_user_id, 'USER', 'gym.create', 'Gym', v_gym_id,
          jsonb_build_object('plan', upper(btrim(p_plan_code)), 'trialEndsAt', v_trial_end), v_now, v_now);

  RETURN QUERY SELECT v_gym_id, v_user_id, v_trial_end;
END $$;

REVOKE ALL ON FUNCTION signup_create_gym(text, text, text, text, text, text, text, text) FROM PUBLIC;
