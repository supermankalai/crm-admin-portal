-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PT_SESSION_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'PT_CREDITS_LOW';
ALTER TYPE "NotificationType" ADD VALUE 'PT_PACKAGE_EXPIRING';

-- AlterTable
ALTER TABLE "Gym" ADD COLUMN     "ptCreditsRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TrainingSession" ADD COLUMN     "complimentary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purchaseId" TEXT;

-- CreateTable
CREATE TABLE "PtPackage" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sessionCount" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PtPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtPackagePurchase" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "trainerId" TEXT,
    "name" TEXT NOT NULL,
    "sessionsTotal" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "soldById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PtPackagePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtPackage_gymId_isActive_idx" ON "PtPackage"("gymId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PtPackage_gymId_id_key" ON "PtPackage"("gymId", "id");

-- CreateIndex
CREATE INDEX "PtPackagePurchase_gymId_memberId_expiresOn_idx" ON "PtPackagePurchase"("gymId", "memberId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "PtPackagePurchase_gymId_id_key" ON "PtPackagePurchase"("gymId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PtPackagePurchase_gymId_invoiceId_key" ON "PtPackagePurchase"("gymId", "invoiceId");

-- CreateIndex
CREATE INDEX "TrainingSession_purchaseId_status_idx" ON "TrainingSession"("purchaseId", "status");

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_gymId_purchaseId_fkey" FOREIGN KEY ("gymId", "purchaseId") REFERENCES "PtPackagePurchase"("gymId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PtPackage" ADD CONSTRAINT "PtPackage_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtPackagePurchase" ADD CONSTRAINT "PtPackagePurchase_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtPackagePurchase" ADD CONSTRAINT "PtPackagePurchase_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtPackagePurchase" ADD CONSTRAINT "PtPackagePurchase_gymId_packageId_fkey" FOREIGN KEY ("gymId", "packageId") REFERENCES "PtPackage"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtPackagePurchase" ADD CONSTRAINT "PtPackagePurchase_gymId_trainerId_fkey" FOREIGN KEY ("gymId", "trainerId") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PtPackagePurchase" ADD CONSTRAINT "PtPackagePurchase_gymId_invoiceId_fkey" FOREIGN KEY ("gymId", "invoiceId") REFERENCES "Invoice"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtPackagePurchase" ADD CONSTRAINT "PtPackagePurchase_gymId_soldById_fkey" FOREIGN KEY ("gymId", "soldById") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════ PT packages: checks and row-level security ═══════════════════════════

ALTER TABLE "PtPackage" ADD CONSTRAINT "PtPackage_values" CHECK (
  "sessionCount" BETWEEN 1 AND 200 AND "priceMinor" >= 0 AND "validityDays" BETWEEN 1 AND 730
  AND length(name) BETWEEN 1 AND 80 AND (description IS NULL OR length(description) <= 300));
ALTER TABLE "PtPackagePurchase" ADD CONSTRAINT "PtPackagePurchase_values" CHECK (
  "sessionsTotal" BETWEEN 1 AND 200 AND "priceMinor" >= 0 AND "expiresOn" >= "startsOn"
  AND (("cancelledAt" IS NULL) = ("cancelReason" IS NULL)) AND ("cancelReason" IS NULL OR length("cancelReason") <= 300));
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_credit" CHECK (NOT (complimentary AND "purchaseId" IS NOT NULL));

-- Owners, managers and front desk: the people who sell things at the counter.
CREATE FUNCTION app_is_front_office_of_current_gym() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "StaffMember" s
                  WHERE s."gymId" = app_current_gym_id() AND s."userId" = app_current_user_id()
                    AND s.status = 'ACTIVE' AND s.role IN ('OWNER', 'MANAGER', 'FRONT_DESK'))
$$;
REVOKE ALL ON FUNCTION app_is_front_office_of_current_gym() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PtPackage', 'PtPackagePurchase'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_gym_change()', t || '_gym_immutable', t);
    -- All staff (and read-only support access) see the catalog and who bought what.
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING ("gymId" = app_current_gym_id() AND (SELECT app_can_access_current_gym()))', t);
  END LOOP;
END $$;

-- The catalog: owners and managers. Never deleted (archived via deletedAt).
CREATE POLICY manager_insert ON "PtPackage" FOR INSERT WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()));
CREATE POLICY manager_update ON "PtPackage" FOR UPDATE
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()))
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_manager_of_current_gym()));
-- Members see what's on sale (for the app).
CREATE POLICY member_read ON "PtPackage" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND (SELECT app_is_member_context()) AND "isActive" AND "deletedAt" IS NULL);

-- Sales: the front office sells and cancels (via void/refund). Never deleted. Members see their own.
CREATE POLICY front_office_insert ON "PtPackagePurchase" FOR INSERT WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_front_office_of_current_gym()));
CREATE POLICY front_office_update ON "PtPackagePurchase" FOR UPDATE
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_front_office_of_current_gym()))
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_front_office_of_current_gym()));
CREATE POLICY member_own_read ON "PtPackagePurchase" FOR SELECT USING (
  "gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));

-- A session may only use a credit of the same member's live package, within its dates, while
-- credits are left. The package row is locked, so two bookings can't both take the last credit.
-- SECURITY DEFINER: trainers book sessions but can't lock (update) packages themselves.
CREATE FUNCTION pt_session_credit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  p "PtPackagePurchase"%ROWTYPE;
  v_day date;
  v_used int;
BEGIN
  IF NEW."purchaseId" IS NULL OR NEW.status = 'CANCELLED' THEN RETURN NEW; END IF;
  -- Closing a session (done / missed) keeps the credit it already holds.
  IF TG_OP = 'UPDATE' AND OLD."purchaseId" IS NOT DISTINCT FROM NEW."purchaseId" AND OLD.status <> 'CANCELLED' THEN RETURN NEW; END IF;
  SELECT * INTO p FROM "PtPackagePurchase" WHERE id = NEW."purchaseId" AND "gymId" = NEW."gymId" FOR UPDATE;
  IF NOT FOUND OR p."memberId" <> NEW."memberId" OR (p."trainerId" IS NOT NULL AND p."trainerId" <> NEW."trainerId") THEN
    RAISE EXCEPTION 'pt:credit_mismatch' USING ERRCODE = '23514';
  END IF;
  IF p."cancelledAt" IS NOT NULL THEN RAISE EXCEPTION 'pt:package_cancelled' USING ERRCODE = '23514'; END IF;
  SELECT (NEW."startsAt" AT TIME ZONE g.timezone)::date INTO v_day FROM "Gym" g WHERE g.id = NEW."gymId";
  IF v_day < p."startsOn" OR v_day > p."expiresOn" THEN RAISE EXCEPTION 'pt:package_dates' USING ERRCODE = '23514'; END IF;
  SELECT count(*) INTO v_used FROM "TrainingSession"
   WHERE "purchaseId" = p.id AND status IN ('SCHEDULED', 'COMPLETED', 'NO_SHOW') AND id <> NEW.id;
  IF v_used >= p."sessionsTotal" THEN RAISE EXCEPTION 'pt:no_credit' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION pt_session_credit_guard() FROM PUBLIC;
CREATE TRIGGER "TrainingSession_credit_guard" BEFORE INSERT OR UPDATE OF "purchaseId", status ON "TrainingSession"
  FOR EACH ROW EXECUTE FUNCTION pt_session_credit_guard();
