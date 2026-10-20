-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('EVERYONE', 'MEMBERS', 'STAFF');

-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CLASS_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'WAITLIST_PROMOTED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'ANNOUNCEMENT';
ALTER TYPE "NotificationType" ADD VALUE 'CLASS_FULL';
ALTER TYPE "NotificationType" ADD VALUE 'DELETION_REQUEST';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "pushedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceSessionId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "invalidatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classReminders" BOOLEAN NOT NULL DEFAULT true,
    "waitlist" BOOLEAN NOT NULL DEFAULT true,
    "membership" BOOLEAN NOT NULL DEFAULT true,
    "payments" BOOLEAN NOT NULL DEFAULT true,
    "announcements" BOOLEAN NOT NULL DEFAULT true,
    "staffAlerts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL,
    "createdById" TEXT NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "pushTokenId" TEXT NOT NULL,
    "ticketId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "receiptCheckedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reasonEnc" TEXT,
    "status" "DeletionRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushToken_gymId_userId_idx" ON "PushToken"("gymId", "userId");

-- CreateIndex
CREATE INDEX "PushToken_token_idx" ON "PushToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_gymId_deviceSessionId_key" ON "PushToken"("gymId", "deviceSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_gymId_userId_key" ON "NotificationPreference"("gymId", "userId");

-- CreateIndex
CREATE INDEX "Announcement_gymId_publishedAt_idx" ON "Announcement"("gymId", "publishedAt");

-- CreateIndex
CREATE INDEX "PushDelivery_status_receiptCheckedAt_createdAt_idx" ON "PushDelivery"("status", "receiptCheckedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushDelivery_notificationId_pushTokenId_key" ON "PushDelivery"("notificationId", "pushTokenId");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_gymId_status_createdAt_idx" ON "AccountDeletionRequest"("gymId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_pushedAt_createdAt_idx" ON "Notification"("pushedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_deviceSessionId_fkey" FOREIGN KEY ("deviceSessionId") REFERENCES "MobileDeviceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_gymId_createdById_fkey" FOREIGN KEY ("gymId", "createdById") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_pushTokenId_fkey" FOREIGN KEY ("pushTokenId") REFERENCES "PushToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_gymId_resolvedById_fkey" FOREIGN KEY ("gymId", "resolvedById") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- History that existed before push delivery is never pushed.
UPDATE "Notification" SET "pushedAt" = now() WHERE "pushedAt" IS NULL;

-- ═══════════════════════════ Checks ═══════════════════════════

ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_shape" CHECK (length(token) BETWEEN 10 AND 200 AND platform IN ('ios', 'android'));
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_text" CHECK (length(title) BETWEEN 1 AND 120 AND length(body) BETWEEN 1 AND 2000);
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_resolution"
  CHECK ((status = 'REQUESTED') = ("resolvedAt" IS NULL) AND ("resolutionNote" IS NULL OR length("resolutionNote") <= 500));
-- One open request per member.
CREATE UNIQUE INDEX "AccountDeletionRequest_one_open" ON "AccountDeletionRequest" ("memberId") WHERE status = 'REQUESTED';
CREATE INDEX "Notification_push_pending" ON "Notification" ("createdAt") WHERE "pushedAt" IS NULL;

-- ═══════════════════════════ Helpers ═══════════════════════════

-- Is this user an active member-app user of the current gym? (notification recipients)
CREATE FUNCTION app_user_is_member_of_current_gym(p_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "MemberAccount" a
                  WHERE a."gymId" = app_current_gym_id() AND a."userId" = p_user_id AND a.status = 'ACTIVE')
$$;
REVOKE ALL ON FUNCTION app_user_is_member_of_current_gym(text) FROM PUBLIC;

-- Is this user an active owner/manager of the current gym? (deletion-request alerts)
CREATE FUNCTION app_user_is_manager_of_current_gym(p_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "StaffMember" s
                  WHERE s."gymId" = app_current_gym_id() AND s."userId" = p_user_id
                    AND s.status = 'ACTIVE' AND s.role IN ('OWNER', 'MANAGER'))
$$;
REVOKE ALL ON FUNCTION app_user_is_manager_of_current_gym(text) FROM PUBLIC;

-- ═══════════════════════════ Row-level security ═══════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PushToken', 'NotificationPreference', 'Announcement', 'AccountDeletionRequest'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_gym_change()', t || '_gym_immutable', t);
  END LOOP;
END $$;
-- Push deliveries belong to the push job only (owner role): no app access at all.
ALTER TABLE "PushDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushDelivery" FORCE ROW LEVEL SECURITY;

-- Push tokens: your own, for the current gym, on one of your own live device sessions.
CREATE POLICY own_read ON "PushToken" FOR SELECT USING ("userId" = app_current_user_id());
CREATE POLICY own_insert ON "PushToken" FOR INSERT WITH CHECK (
  "gymId" = app_current_gym_id() AND "userId" = app_current_user_id()
  AND ((SELECT app_is_staff_of_current_gym()) OR (SELECT app_is_member_context()))
  AND EXISTS (SELECT 1 FROM "MobileDeviceSession" d WHERE d.id = "deviceSessionId" AND d."userId" = app_current_user_id() AND d."revokedAt" IS NULL));
CREATE POLICY own_update ON "PushToken" FOR UPDATE
  USING ("userId" = app_current_user_id() AND "gymId" = app_current_gym_id())
  WITH CHECK ("userId" = app_current_user_id() AND "gymId" = app_current_gym_id()
              AND EXISTS (SELECT 1 FROM "MobileDeviceSession" d WHERE d.id = "deviceSessionId" AND d."userId" = app_current_user_id() AND d."revokedAt" IS NULL));
-- Logout removes the device's tokens for every gym, so no gym is needed here.
CREATE POLICY own_delete ON "PushToken" FOR DELETE USING ("userId" = app_current_user_id());

-- Preferences: your own, per gym.
CREATE POLICY own_all ON "NotificationPreference" FOR ALL
  USING ("gymId" = app_current_gym_id() AND "userId" = app_current_user_id()
         AND ((SELECT app_is_staff_of_current_gym()) OR (SELECT app_is_member_context())))
  WITH CHECK ("gymId" = app_current_gym_id() AND "userId" = app_current_user_id()
         AND ((SELECT app_is_staff_of_current_gym()) OR (SELECT app_is_member_context())));

-- Announcements: staff (and support access) read all; members read those meant for them;
-- owners and managers publish and delete. Never edited after publishing.
CREATE POLICY staff_read ON "Announcement" FOR SELECT USING ("gymId" = app_current_gym_id() AND (SELECT app_can_access_current_gym()));
CREATE POLICY member_read ON "Announcement" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_member_context()) AND audience IN ('EVERYONE', 'MEMBERS') AND "publishedAt" <= now());
CREATE POLICY manager_insert ON "Announcement" FOR INSERT WITH CHECK (
  "gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()) AND "createdById" = (SELECT app_current_staff_id()));
CREATE POLICY manager_delete ON "Announcement" FOR DELETE USING ("gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()));

-- Deletion requests: the member files and reads their own; staff read; owners/managers resolve.
CREATE POLICY member_own_read ON "AccountDeletionRequest" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));
CREATE POLICY member_own_insert ON "AccountDeletionRequest" FOR INSERT WITH CHECK (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id())
  AND "userId" = app_current_user_id() AND status = 'REQUESTED' AND "resolvedById" IS NULL);
CREATE POLICY staff_read ON "AccountDeletionRequest" FOR SELECT USING ("gymId" = app_current_gym_id() AND (SELECT app_can_access_current_gym()));
CREATE POLICY manager_update ON "AccountDeletionRequest" FOR UPDATE
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()))
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()));

-- Notifications: members read and mark their own (staff already can).
CREATE POLICY member_own_read ON "Notification" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_member_context()) AND "recipientUserId" = app_current_user_id());
CREATE POLICY member_own_update ON "Notification" FOR UPDATE
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_member_context()) AND "recipientUserId" = app_current_user_id())
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_member_context()) AND "recipientUserId" = app_current_user_id());
-- During a member action, two kinds may be created for someone else: a waitlist promotion for the
-- member moved up, and a deletion-request alert for the gym's managers.
CREATE POLICY member_action_insert ON "Notification" FOR INSERT WITH CHECK (
  "gymId" = app_current_gym_id() AND (SELECT app_is_member_action())
  AND ((type::text = 'WAITLIST_PROMOTED' AND app_user_is_member_of_current_gym("recipientUserId"))
    OR (type::text = 'DELETION_REQUEST' AND app_user_is_manager_of_current_gym("recipientUserId"))));

-- ═══════════════════════════ Member actions (definer functions) ═══════════════════════════

-- A member updates their own contact details. Values arrive already encrypted by the app (the
-- database never sees them in clear); only these columns can change.
CREATE FUNCTION member_update_own_contact(p_email text, p_phone_enc text, p_phone_bi text, p_address_enc text, p_emergency_enc text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE v_member text := app_current_member_id();
BEGIN
  IF v_member IS NULL OR NOT (SELECT app_is_member_action()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE "Member"
     SET email = p_email, "phoneEnc" = p_phone_enc, "phoneBlindIndex" = p_phone_bi,
         "addressEnc" = p_address_enc, "emergencyContactEnc" = p_emergency_enc, "updatedAt" = now()
   WHERE id = v_member AND "gymId" = app_current_gym_id() AND "deletedAt" IS NULL;
END $$;
REVOKE ALL ON FUNCTION member_update_own_contact(text, text, text, text, text) FROM PUBLIC;

-- Completing a deletion request: erase the member's fitness data. Managers can't read progress
-- photos (decision 4), so this definer function removes them and returns the files to delete.
CREATE FUNCTION erase_member_fitness_data(p_member_id text)
RETURNS TABLE (storage_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  IF NOT (SELECT app_is_manager_of_current_gym())
     OR NOT EXISTS (SELECT 1 FROM "AccountDeletionRequest" r WHERE r."memberId" = p_member_id AND r."gymId" = app_current_gym_id() AND r.status = 'REQUESTED') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  DELETE FROM "ProgressEntry" WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id();
  DELETE FROM "WorkoutCompletion" WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id();
  DELETE FROM "TrainerClientNote" WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id();
  DELETE FROM "WorkoutPlan" WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id();
  RETURN QUERY DELETE FROM "ProgressPhoto" WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id() RETURNING "storageKey";
END $$;
REVOKE ALL ON FUNCTION erase_member_fitness_data(text) FROM PUBLIC;
