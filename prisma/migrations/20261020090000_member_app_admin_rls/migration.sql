-- Member app accounts and invites: only roles that may manage members' contact details (owner,
-- manager, front desk) may create or change them. Trainers can still read them (tenant_read).
-- The app already checks members.editContact; this makes the database agree.

CREATE FUNCTION app_can_manage_member_app() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "StaffMember" s
                  WHERE s."gymId" = app_current_gym_id() AND s."userId" = app_current_user_id()
                    AND s.status = 'ACTIVE' AND s.role IN ('OWNER', 'MANAGER', 'FRONT_DESK'))
$$;
REVOKE ALL ON FUNCTION app_can_manage_member_app() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MemberAccount', 'MemberAppInvite'] LOOP
    EXECUTE format('DROP POLICY tenant_insert ON %I', t);
    EXECUTE format('DROP POLICY tenant_update ON %I', t);
    EXECUTE format('DROP POLICY tenant_delete ON %I', t);
    EXECUTE format('CREATE POLICY manager_insert ON %I FOR INSERT WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_can_manage_member_app()))', t);
    EXECUTE format('CREATE POLICY manager_update ON %I FOR UPDATE USING ("gymId" = app_current_gym_id() AND (SELECT app_can_manage_member_app())) WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_can_manage_member_app()))', t);
    EXECUTE format('CREATE POLICY manager_delete ON %I FOR DELETE USING ("gymId" = app_current_gym_id() AND (SELECT app_can_manage_member_app()))', t);
  END LOOP;
END $$;
