-- Members (member app) may read their own gym's logo file record — and nothing else in FileAsset.
-- The logo bytes are served only through short-lived signed URLs that re-check membership.
CREATE POLICY member_read_gym_logo ON "FileAsset" FOR SELECT
  USING ("gymId" = app_current_gym_id() AND kind = 'GYM_LOGO' AND (SELECT app_current_member_id()) IS NOT NULL);
