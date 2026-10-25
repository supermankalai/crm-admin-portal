-- Recipients for notifications created during a member's own action, where the member can't
-- read the rows that say who should be told (other members' accounts, staff records).
-- Each returns user ids only, for the current gym, and only in a staff or member context.

-- The member-app user of a member in the current gym, if their account is active.
CREATE FUNCTION member_app_user_id(p_member_id text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT a."userId" FROM "MemberAccount" a
   WHERE a."gymId" = app_current_gym_id() AND a."memberId" = p_member_id AND a.status = 'ACTIVE'
     AND ((SELECT app_is_staff_of_current_gym()) OR (SELECT app_is_member_context()))
$$;
REVOKE ALL ON FUNCTION member_app_user_id(text) FROM PUBLIC;

-- The current gym's active owners and managers (who handle deletion requests).
CREATE FUNCTION gym_manager_user_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT s."userId" FROM "StaffMember" s
   WHERE s."gymId" = app_current_gym_id() AND s.status = 'ACTIVE' AND s.role IN ('OWNER', 'MANAGER')
     AND ((SELECT app_is_staff_of_current_gym()) OR (SELECT app_is_member_context()))
$$;
REVOKE ALL ON FUNCTION gym_manager_user_ids() FROM PUBLIC;
