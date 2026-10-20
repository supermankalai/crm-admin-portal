-- Completing a deletion request also removes the member's own inbox and device tokens for this
-- gym (their notifications mention their classes, invoices and membership).
CREATE OR REPLACE FUNCTION erase_member_fitness_data(p_member_id text)
RETURNS TABLE (storage_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE v_user text;
BEGIN
  IF NOT (SELECT app_is_manager_of_current_gym())
     OR NOT EXISTS (SELECT 1 FROM "AccountDeletionRequest" r WHERE r."memberId" = p_member_id AND r."gymId" = app_current_gym_id() AND r.status = 'REQUESTED') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT a."userId" INTO v_user FROM "MemberAccount" a WHERE a."memberId" = p_member_id AND a."gymId" = app_current_gym_id();
  DELETE FROM "ProgressEntry" WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id();
  DELETE FROM "WorkoutCompletion" WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id();
  DELETE FROM "TrainerClientNote" WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id();
  DELETE FROM "WorkoutPlan" WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id();
  IF v_user IS NOT NULL THEN
    DELETE FROM "Notification" WHERE "recipientUserId" = v_user AND "gymId" = app_current_gym_id();
    DELETE FROM "PushToken" WHERE "userId" = v_user AND "gymId" = app_current_gym_id();
    DELETE FROM "NotificationPreference" WHERE "userId" = v_user AND "gymId" = app_current_gym_id();
  END IF;
  RETURN QUERY DELETE FROM "ProgressPhoto" WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id() RETURNING "storageKey";
END $$;
REVOKE ALL ON FUNCTION erase_member_fitness_data(text) FROM PUBLIC;
