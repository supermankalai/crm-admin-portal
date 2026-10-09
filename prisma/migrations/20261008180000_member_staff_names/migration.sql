-- Members can't read StaffMember or User rows. Workout plans and PT sessions show the trainer's
-- name, so this returns only id → display name, only for staff of the member's own gym.
CREATE FUNCTION member_staff_names(p_ids text[])
RETURNS TABLE (id text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT s.id, u.name
    FROM "StaffMember" s
    JOIN "User" u ON u.id = s."userId"
   WHERE s."gymId" = app_current_gym_id()
     AND (SELECT app_is_member_context())
     AND s.id = ANY (p_ids)
     AND cardinality(p_ids) <= 100
$$;
REVOKE ALL ON FUNCTION member_staff_names(text[]) FROM PUBLIC;
