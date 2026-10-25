-- CreateEnum
CREATE TYPE "PtGoal" AS ENUM ('WEIGHT_LOSS', 'MUSCLE_GAIN', 'STRENGTH', 'ENDURANCE', 'GENERAL_FITNESS', 'REHAB', 'SPORT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PT_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'PT_ENDED';
ALTER TYPE "NotificationType" ADD VALUE 'PT_SESSION_BOOKED';
ALTER TYPE "NotificationType" ADD VALUE 'PT_SESSION_CANCELLED';

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "training" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TrainerClient" ADD COLUMN     "assignedById" TEXT,
ADD COLUMN     "goal" "PtGoal",
ADD COLUMN     "startedOn" DATE NOT NULL DEFAULT CURRENT_DATE,
ADD COLUMN     "targetsEnc" TEXT;

-- AlterTable
ALTER TABLE "TrainingSession" ADD COLUMN     "bookedById" TEXT;

-- CreateTable
CREATE TABLE "PtAssignmentHistory" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "goal" "PtGoal",
    "targetsEnc" TEXT,
    "startedOn" DATE NOT NULL,
    "assignedById" TEXT,
    "endedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedById" TEXT NOT NULL,
    "endReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtAssignmentHistory_gymId_memberId_endedAt_idx" ON "PtAssignmentHistory"("gymId", "memberId", "endedAt");

-- CreateIndex
CREATE INDEX "PtAssignmentHistory_gymId_trainerId_endedAt_idx" ON "PtAssignmentHistory"("gymId", "trainerId", "endedAt");

-- AddForeignKey
ALTER TABLE "TrainerClient" ADD CONSTRAINT "TrainerClient_gymId_assignedById_fkey" FOREIGN KEY ("gymId", "assignedById") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PtAssignmentHistory" ADD CONSTRAINT "PtAssignmentHistory_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtAssignmentHistory" ADD CONSTRAINT "PtAssignmentHistory_gymId_trainerId_fkey" FOREIGN KEY ("gymId", "trainerId") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtAssignmentHistory" ADD CONSTRAINT "PtAssignmentHistory_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_gymId_bookedById_fkey" FOREIGN KEY ("gymId", "bookedById") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ═══════════════════════════ PT module: data and row-level security ═══════════════════════════

-- Existing assignments started on the (gym-local) day they were made.
UPDATE "TrainerClient" tc SET "startedOn" = (tc."createdAt" AT TIME ZONE g.timezone)::date
  FROM "Gym" g WHERE g.id = tc."gymId";

-- Assignments are made, changed and ended by owners and managers only (the app checks pt.manage;
-- this makes the database agree). All staff still read them; members read their own.
DROP POLICY tenant_insert ON "TrainerClient";
DROP POLICY tenant_update ON "TrainerClient";
DROP POLICY tenant_delete ON "TrainerClient";
CREATE POLICY manager_insert ON "TrainerClient" FOR INSERT WITH CHECK (
  "gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()));
CREATE POLICY manager_update ON "TrainerClient" FOR UPDATE
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()))
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()));
CREATE POLICY manager_delete ON "TrainerClient" FOR DELETE USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()));
CREATE POLICY member_own_read ON "TrainerClient" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));

-- Ended assignments: managers see all, a trainer their own. Append-only (see 002_grants.sql).
-- Like the other fitness tables, support access doesn't see them.
ALTER TABLE "PtAssignmentHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PtAssignmentHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON "PtAssignmentHistory" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
  AND ((SELECT app_is_manager_of_current_gym()) OR "trainerId" = (SELECT app_current_staff_id())));
CREATE POLICY manager_insert ON "PtAssignmentHistory" FOR INSERT WITH CHECK (
  "gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()));

ALTER TABLE "PtAssignmentHistory" ADD CONSTRAINT "PtAssignmentHistory_reason" CHECK ("endReason" IS NULL OR length("endReason") <= 200);

-- Erasing a member's fitness data also removes their goal targets (health data).
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
  UPDATE "TrainerClient" SET "targetsEnc" = NULL WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id();
  UPDATE "PtAssignmentHistory" SET "targetsEnc" = NULL WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id();
  IF v_user IS NOT NULL THEN
    DELETE FROM "Notification" WHERE "recipientUserId" = v_user AND "gymId" = app_current_gym_id();
    DELETE FROM "PushToken" WHERE "userId" = v_user AND "gymId" = app_current_gym_id();
    DELETE FROM "NotificationPreference" WHERE "userId" = v_user AND "gymId" = app_current_gym_id();
  END IF;
  RETURN QUERY DELETE FROM "ProgressPhoto" WHERE "memberId" = p_member_id AND "gymId" = app_current_gym_id() RETURNING "storageKey";
END $$;
REVOKE ALL ON FUNCTION erase_member_fitness_data(text) FROM PUBLIC;
