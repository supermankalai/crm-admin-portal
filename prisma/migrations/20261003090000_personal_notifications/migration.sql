-- Notifications are personal. The generic tenant policies let any staff member of the gym read
-- every row; replace them so a staff member can read, update (mark read) and delete only their
-- own notifications. Inserting for colleagues (alert fan-out) stays allowed for active staff.
-- Support access sees no notifications (the super admin is never a recipient).

DROP POLICY tenant_read ON "Notification";
DROP POLICY tenant_update ON "Notification";
DROP POLICY tenant_delete ON "Notification";

CREATE POLICY notification_own_read ON "Notification" FOR SELECT
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND "recipientUserId" = app_current_user_id());

CREATE POLICY notification_own_update ON "Notification" FOR UPDATE
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND "recipientUserId" = app_current_user_id())
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND "recipientUserId" = app_current_user_id());

CREATE POLICY notification_own_delete ON "Notification" FOR DELETE
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND "recipientUserId" = app_current_user_id());

-- Only the read marker may change: a notification's content is what the system sent.
CREATE FUNCTION notification_content_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  IF (NEW."recipientUserId", NEW.type, NEW.title, NEW.body, NEW."entityType", NEW."entityId", NEW."dedupeKey", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."recipientUserId", OLD.type, OLD.title, OLD.body, OLD."entityType", OLD."entityId", OLD."dedupeKey", OLD."createdAt") THEN
    RAISE EXCEPTION 'notification content cannot be changed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Notification_content_immutable" BEFORE UPDATE ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION notification_content_immutable();

-- A gym logo must be one of the gym's own GYM_LOGO files.
CREATE FUNCTION gym_logo_belongs_to_gym() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  IF NEW."logoFileId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "FileAsset" f WHERE f.id = NEW."logoFileId" AND f."gymId" = NEW.id AND f.kind = 'GYM_LOGO') THEN
    RAISE EXCEPTION 'logo file does not belong to this gym' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gym_logo_belongs_to_gym() FROM PUBLIC;

CREATE TRIGGER "Gym_logo_owned" BEFORE INSERT OR UPDATE OF "logoFileId" ON "Gym"
  FOR EACH ROW EXECUTE FUNCTION gym_logo_belongs_to_gym();
