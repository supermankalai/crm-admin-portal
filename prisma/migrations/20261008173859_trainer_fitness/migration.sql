-- CreateEnum
CREATE TYPE "WorkoutPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrainingSessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "WorkoutPlan" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "memberId" TEXT,
    "title" TEXT NOT NULL,
    "notesEnc" TEXT,
    "status" "WorkoutPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkoutPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutPlanDay" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkoutPlanDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutExercise" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sets" INTEGER,
    "reps" TEXT,
    "restSeconds" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkoutExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutCompletion" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "noteEnc" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkoutCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressEntry" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "recordedOn" DATE NOT NULL,
    "measurementsEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressPhoto" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "takenOn" DATE NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProgressPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerClientNote" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "bodyEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrainerClientNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "TrainingSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "focus" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkoutPlan_gymId_trainerId_idx" ON "WorkoutPlan"("gymId", "trainerId");

-- CreateIndex
CREATE INDEX "WorkoutPlan_gymId_memberId_status_idx" ON "WorkoutPlan"("gymId", "memberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutPlan_gymId_id_key" ON "WorkoutPlan"("gymId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutPlanDay_gymId_id_key" ON "WorkoutPlanDay"("gymId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutPlanDay_planId_position_key" ON "WorkoutPlanDay"("planId", "position");

-- CreateIndex
CREATE INDEX "WorkoutExercise_gymId_idx" ON "WorkoutExercise"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutExercise_dayId_position_key" ON "WorkoutExercise"("dayId", "position");

-- CreateIndex
CREATE INDEX "WorkoutCompletion_gymId_memberId_completedAt_idx" ON "WorkoutCompletion"("gymId", "memberId", "completedAt");

-- CreateIndex
CREATE INDEX "WorkoutCompletion_dayId_completedAt_idx" ON "WorkoutCompletion"("dayId", "completedAt");

-- CreateIndex
CREATE INDEX "ProgressEntry_gymId_memberId_recordedOn_idx" ON "ProgressEntry"("gymId", "memberId", "recordedOn");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressEntry_memberId_recordedOn_key" ON "ProgressEntry"("memberId", "recordedOn");

-- CreateIndex
CREATE INDEX "ProgressPhoto_gymId_memberId_takenOn_idx" ON "ProgressPhoto"("gymId", "memberId", "takenOn");

-- CreateIndex
CREATE INDEX "TrainerClientNote_gymId_memberId_createdAt_idx" ON "TrainerClientNote"("gymId", "memberId", "createdAt");

-- CreateIndex
CREATE INDEX "TrainingSession_gymId_trainerId_startsAt_idx" ON "TrainingSession"("gymId", "trainerId", "startsAt");

-- CreateIndex
CREATE INDEX "TrainingSession_gymId_memberId_startsAt_idx" ON "TrainingSession"("gymId", "memberId", "startsAt");

-- AddForeignKey
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_gymId_trainerId_fkey" FOREIGN KEY ("gymId", "trainerId") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlanDay" ADD CONSTRAINT "WorkoutPlanDay_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlanDay" ADD CONSTRAINT "WorkoutPlanDay_gymId_planId_fkey" FOREIGN KEY ("gymId", "planId") REFERENCES "WorkoutPlan"("gymId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_gymId_dayId_fkey" FOREIGN KEY ("gymId", "dayId") REFERENCES "WorkoutPlanDay"("gymId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutCompletion" ADD CONSTRAINT "WorkoutCompletion_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutCompletion" ADD CONSTRAINT "WorkoutCompletion_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutCompletion" ADD CONSTRAINT "WorkoutCompletion_gymId_dayId_fkey" FOREIGN KEY ("gymId", "dayId") REFERENCES "WorkoutPlanDay"("gymId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressPhoto" ADD CONSTRAINT "ProgressPhoto_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressPhoto" ADD CONSTRAINT "ProgressPhoto_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerClientNote" ADD CONSTRAINT "TrainerClientNote_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerClientNote" ADD CONSTRAINT "TrainerClientNote_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerClientNote" ADD CONSTRAINT "TrainerClientNote_gymId_authorId_fkey" FOREIGN KEY ("gymId", "authorId") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_gymId_trainerId_fkey" FOREIGN KEY ("gymId", "trainerId") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════ Checks ═══════════════════════════

ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_title" CHECK (length(title) BETWEEN 1 AND 120);
ALTER TABLE "WorkoutPlanDay" ADD CONSTRAINT "WorkoutPlanDay_shape" CHECK (position BETWEEN 0 AND 30 AND length(title) BETWEEN 1 AND 80);
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_shape" CHECK (
  position BETWEEN 0 AND 50
  AND length(name) BETWEEN 1 AND 120
  AND (sets IS NULL OR sets BETWEEN 1 AND 100)
  AND (reps IS NULL OR length(reps) BETWEEN 1 AND 20)
  AND ("restSeconds" IS NULL OR "restSeconds" BETWEEN 0 AND 3600)
  AND (notes IS NULL OR length(notes) <= 500));
ALTER TABLE "ProgressPhoto" ADD CONSTRAINT "ProgressPhoto_size" CHECK ("sizeBytes" > 0);
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_times" CHECK ("endsAt" > "startsAt" AND "endsAt" - "startsAt" <= interval '8 hours');
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_focus" CHECK (focus IS NULL OR length(focus) <= 120);

-- ═══════════════════════════ Helpers ═══════════════════════════

-- The current user's active staff record in the current gym (null for members and everyone else).
CREATE FUNCTION app_current_staff_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT s.id FROM "StaffMember" s
   WHERE s."gymId" = app_current_gym_id() AND s."userId" = app_current_user_id() AND s.status = 'ACTIVE'
$$;
REVOKE ALL ON FUNCTION app_current_staff_id() FROM PUBLIC;

CREATE FUNCTION app_is_manager_of_current_gym() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "StaffMember" s
                  WHERE s."gymId" = app_current_gym_id() AND s."userId" = app_current_user_id()
                    AND s.status = 'ACTIVE' AND s.role IN ('OWNER', 'MANAGER'))
$$;
REVOKE ALL ON FUNCTION app_is_manager_of_current_gym() FROM PUBLIC;

-- Is the current user an assigned trainer of this member (TrainerClient)?
CREATE FUNCTION app_is_trainer_of(p_member_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "TrainerClient" tc
                  WHERE tc."gymId" = app_current_gym_id() AND tc."memberId" = p_member_id
                    AND tc."trainerId" = app_current_staff_id())
$$;
REVOKE ALL ON FUNCTION app_is_trainer_of(text) FROM PUBLIC;

-- ═══════════════════════════ Row-level security ═══════════════════════════
-- Not the gym-wide staff policies other tenant tables use: workouts and progress are visible to
-- the member, their assigned trainers, and (except photos) managers/owners. Support access sees
-- none of it. Front desk sees none of it except PT appointments.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['WorkoutPlan', 'WorkoutPlanDay', 'WorkoutExercise', 'WorkoutCompletion', 'ProgressEntry', 'ProgressPhoto', 'TrainerClientNote', 'TrainingSession'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_gym_change()', t || '_gym_immutable', t);
  END LOOP;
END $$;

-- Workout plans: managers see all; trainers see plans they wrote and plans of their clients;
-- the author (or a manager) edits. A trainer can only assign a plan to their own client.
CREATE POLICY staff_read ON "WorkoutPlan" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
  AND ((SELECT app_is_manager_of_current_gym()) OR "trainerId" = (SELECT app_current_staff_id())
       OR ("memberId" IS NOT NULL AND app_is_trainer_of("memberId"))));
CREATE POLICY staff_insert ON "WorkoutPlan" FOR INSERT WITH CHECK (
  "gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
  AND ((SELECT app_is_manager_of_current_gym())
       OR ("trainerId" = (SELECT app_current_staff_id()) AND ("memberId" IS NULL OR app_is_trainer_of("memberId")))));
CREATE POLICY staff_update ON "WorkoutPlan" FOR UPDATE
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND ((SELECT app_is_manager_of_current_gym()) OR "trainerId" = (SELECT app_current_staff_id())))
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND ((SELECT app_is_manager_of_current_gym())
              OR ("trainerId" = (SELECT app_current_staff_id()) AND ("memberId" IS NULL OR app_is_trainer_of("memberId")))));
CREATE POLICY staff_delete ON "WorkoutPlan" FOR DELETE USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
  AND ((SELECT app_is_manager_of_current_gym()) OR "trainerId" = (SELECT app_current_staff_id())));
CREATE POLICY member_own_read ON "WorkoutPlan" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()) AND status = 'ACTIVE');

-- Days and exercises follow their plan (the subqueries are themselves filtered by RLS).
CREATE POLICY plan_visible_read ON "WorkoutPlanDay" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND EXISTS (SELECT 1 FROM "WorkoutPlan" p WHERE p.id = "planId"));
CREATE POLICY plan_author_write ON "WorkoutPlanDay" FOR ALL
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND EXISTS (SELECT 1 FROM "WorkoutPlan" p WHERE p.id = "planId"
                      AND ((SELECT app_is_manager_of_current_gym()) OR p."trainerId" = (SELECT app_current_staff_id()))))
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND EXISTS (SELECT 1 FROM "WorkoutPlan" p WHERE p.id = "planId"
                      AND ((SELECT app_is_manager_of_current_gym()) OR p."trainerId" = (SELECT app_current_staff_id()))));

CREATE POLICY plan_visible_read ON "WorkoutExercise" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND EXISTS (SELECT 1 FROM "WorkoutPlanDay" d WHERE d.id = "dayId"));
CREATE POLICY plan_author_write ON "WorkoutExercise" FOR ALL
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND EXISTS (SELECT 1 FROM "WorkoutPlanDay" d JOIN "WorkoutPlan" p ON p.id = d."planId" WHERE d.id = "dayId"
                      AND ((SELECT app_is_manager_of_current_gym()) OR p."trainerId" = (SELECT app_current_staff_id()))))
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND EXISTS (SELECT 1 FROM "WorkoutPlanDay" d JOIN "WorkoutPlan" p ON p.id = d."planId" WHERE d.id = "dayId"
                      AND ((SELECT app_is_manager_of_current_gym()) OR p."trainerId" = (SELECT app_current_staff_id()))));

-- Completions: the member logs and undoes their own (only on days of their own active plans);
-- managers and assigned trainers read.
CREATE POLICY member_own_read ON "WorkoutCompletion" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));
CREATE POLICY member_own_insert ON "WorkoutCompletion" FOR INSERT WITH CHECK (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id())
  AND EXISTS (SELECT 1 FROM "WorkoutPlanDay" d WHERE d.id = "dayId"));
CREATE POLICY member_own_delete ON "WorkoutCompletion" FOR DELETE USING (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));
CREATE POLICY staff_read ON "WorkoutCompletion" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
  AND ((SELECT app_is_manager_of_current_gym()) OR app_is_trainer_of("memberId")));

-- Measurements: the member's own; managers and assigned trainers read.
CREATE POLICY member_own_all ON "ProgressEntry" FOR ALL
  USING ("gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()))
  WITH CHECK ("gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));
CREATE POLICY staff_read ON "ProgressEntry" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
  AND ((SELECT app_is_manager_of_current_gym()) OR app_is_trainer_of("memberId")));

-- Photos: the member and their assigned trainers only — not managers or owners (decision 4).
CREATE POLICY member_own_read ON "ProgressPhoto" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));
CREATE POLICY member_own_insert ON "ProgressPhoto" FOR INSERT WITH CHECK (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));
CREATE POLICY member_own_delete ON "ProgressPhoto" FOR DELETE USING (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));
CREATE POLICY trainer_read ON "ProgressPhoto" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym()) AND app_is_trainer_of("memberId"));

-- Private trainer notes: the author, plus managers/owners. Written only about one's own clients.
CREATE POLICY staff_read ON "TrainerClientNote" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
  AND ("authorId" = (SELECT app_current_staff_id()) OR (SELECT app_is_manager_of_current_gym())));
CREATE POLICY author_insert ON "TrainerClientNote" FOR INSERT WITH CHECK (
  "gymId" = app_current_gym_id() AND "authorId" = (SELECT app_current_staff_id())
  AND (app_is_trainer_of("memberId") OR (SELECT app_is_manager_of_current_gym())));
CREATE POLICY author_update ON "TrainerClientNote" FOR UPDATE
  USING ("gymId" = app_current_gym_id() AND "authorId" = (SELECT app_current_staff_id()))
  WITH CHECK ("gymId" = app_current_gym_id() AND "authorId" = (SELECT app_current_staff_id()));
CREATE POLICY author_delete ON "TrainerClientNote" FOR DELETE USING (
  "gymId" = app_current_gym_id() AND "authorId" = (SELECT app_current_staff_id()));

-- PT sessions: all staff see the schedule; a trainer books and updates their own sessions with
-- their own clients; managers manage all. Never deleted — cancelled instead. Members see theirs.
CREATE POLICY staff_read ON "TrainingSession" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym()));
CREATE POLICY staff_insert ON "TrainingSession" FOR INSERT WITH CHECK (
  "gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
  AND ((SELECT app_is_manager_of_current_gym())
       OR ("trainerId" = (SELECT app_current_staff_id()) AND app_is_trainer_of("memberId"))));
CREATE POLICY staff_update ON "TrainingSession" FOR UPDATE
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND ((SELECT app_is_manager_of_current_gym()) OR "trainerId" = (SELECT app_current_staff_id())))
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_staff_of_current_gym())
         AND ((SELECT app_is_manager_of_current_gym())
              OR ("trainerId" = (SELECT app_current_staff_id()) AND app_is_trainer_of("memberId"))));
CREATE POLICY member_own_read ON "TrainingSession" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));
