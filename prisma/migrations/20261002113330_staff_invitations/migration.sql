-- Staff invitations: looking up and accepting an invitation happens BEFORE the invitee has a
-- tenant context (they may not even have an account), so both steps are narrow SECURITY DEFINER
-- functions keyed by the SHA-256 hash of the emailed token. The raw token is never stored.

CREATE FUNCTION invitation_lookup(p_token_hash text)
RETURNS TABLE (gym_name text, gym_slug text, email text, role text, state text, has_account boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT g.name, g.slug, i.email, i.role::text,
         CASE WHEN i."revokedAt" IS NOT NULL THEN 'revoked'
              WHEN i."acceptedAt" IS NOT NULL THEN 'used'
              WHEN i."expiresAt" <= now() THEN 'expired'
              ELSE 'valid' END,
         EXISTS (SELECT 1 FROM "User" u WHERE u.email = i.email)
    FROM "StaffInvitation" i JOIN "Gym" g ON g.id = i."gymId"
   WHERE i."tokenHash" = p_token_hash
$$;

-- Accept an invitation. Either the signed-in user (app.current_user_id) whose email matches the
-- invitation, or — when no account exists for that email — a new user created from p_name and
-- p_password_hash. Single use: the invitation row is locked and marked accepted.
CREATE FUNCTION invitation_accept(p_token_hash text, p_name text, p_password_hash text)
RETURNS TABLE (user_id text, gym_slug text, created_user boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_inv "StaffInvitation"%ROWTYPE;
  v_user_id text;
  v_current text := app_current_user_id();
  v_created boolean := false;
  v_staff_id text;
  v_staff_status text;
  v_slug text;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_inv FROM "StaffInvitation" WHERE "tokenHash" = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite:not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_inv."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'invite:revoked' USING ERRCODE = 'P0001'; END IF;
  IF v_inv."acceptedAt" IS NOT NULL THEN RAISE EXCEPTION 'invite:used' USING ERRCODE = 'P0001'; END IF;
  IF v_inv."expiresAt" <= v_now THEN RAISE EXCEPTION 'invite:expired' USING ERRCODE = 'P0001'; END IF;

  SELECT id INTO v_user_id FROM "User" WHERE email = v_inv.email;
  IF v_user_id IS NOT NULL THEN
    -- An existing account must be signed in as that same account.
    IF v_current IS NULL THEN RAISE EXCEPTION 'invite:login_required' USING ERRCODE = 'P0001'; END IF;
    IF v_current <> v_user_id THEN RAISE EXCEPTION 'invite:email_mismatch' USING ERRCODE = 'P0001'; END IF;
  ELSE
    IF v_current IS NOT NULL THEN RAISE EXCEPTION 'invite:email_mismatch' USING ERRCODE = 'P0001'; END IF;
    IF NULLIF(btrim(p_name), '') IS NULL OR p_password_hash IS NULL OR p_password_hash NOT LIKE '$argon2id$%' THEN
      RAISE EXCEPTION 'invite:missing_account_details' USING ERRCODE = 'P0001';
    END IF;
    v_user_id := gen_random_uuid()::text;
    INSERT INTO "User" (id, email, name, "passwordHash", "createdAt", "updatedAt")
    VALUES (v_user_id, v_inv.email, btrim(p_name), p_password_hash, v_now, v_now);
    v_created := true;
  END IF;

  SELECT id, status::text INTO v_staff_id, v_staff_status FROM "StaffMember" WHERE "gymId" = v_inv."gymId" AND "userId" = v_user_id;
  IF v_staff_status = 'ACTIVE' THEN RAISE EXCEPTION 'invite:already_member' USING ERRCODE = 'P0001'; END IF;
  IF v_staff_id IS NOT NULL THEN
    -- Re-joining after removal: reactivate with the invited role (plan limit trigger applies).
    UPDATE "StaffMember" SET status = 'ACTIVE', role = v_inv.role, "removedAt" = NULL, "updatedAt" = v_now WHERE id = v_staff_id;
  ELSE
    v_staff_id := gen_random_uuid()::text;
    INSERT INTO "StaffMember" (id, "gymId", "userId", role, status, "createdAt", "updatedAt")
    VALUES (v_staff_id, v_inv."gymId", v_user_id, v_inv.role, 'ACTIVE', v_now, v_now);
  END IF;

  UPDATE "StaffInvitation" SET "acceptedAt" = v_now, "updatedAt" = v_now WHERE id = v_inv.id;

  INSERT INTO "AuditLog" (id, "gymId", "actorUserId", "actorType", action, "entityType", "entityId", changes, "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_inv."gymId", v_user_id, 'USER', 'staff.invite_accepted', 'StaffMember', v_staff_id,
          jsonb_build_object('role', v_inv.role::text, 'invitationId', v_inv.id, 'newAccount', v_created), v_now, v_now);

  SELECT slug INTO v_slug FROM "Gym" WHERE id = v_inv."gymId";
  RETURN QUERY SELECT v_user_id, v_slug, v_created;
END $$;

REVOKE ALL ON FUNCTION invitation_lookup(text), invitation_accept(text, text, text) FROM PUBLIC;
