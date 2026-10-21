-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('IN_PERSON', 'ONLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "LiveRoomKind" AS ENUM ('CLASS', 'PT');

-- AlterTable
ALTER TABLE "ClassSession" ADD COLUMN     "deliveryMode" "DeliveryMode" NOT NULL DEFAULT 'IN_PERSON',
ALTER COLUMN "roomId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PlatformPlan" ADD COLUMN     "featureLiveSessions" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TrainingSession" ADD COLUMN     "deliveryMode" "DeliveryMode" NOT NULL DEFAULT 'IN_PERSON';

-- CreateTable
CREATE TABLE "LiveAttendance" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "kind" "LiveRoomKind" NOT NULL,
    "sessionId" TEXT NOT NULL,
    "memberId" TEXT,
    "staffId" TEXT,
    "firstJoinedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastLeftAt" TIMESTAMPTZ(3),
    "connectedAt" TIMESTAMPTZ(3),
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LiveAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveAttendance_gymId_kind_sessionId_idx" ON "LiveAttendance"("gymId", "kind", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveAttendance_gymId_kind_sessionId_memberId_key" ON "LiveAttendance"("gymId", "kind", "sessionId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveAttendance_gymId_kind_sessionId_staffId_key" ON "LiveAttendance"("gymId", "kind", "sessionId", "staffId");

-- AddForeignKey
ALTER TABLE "LiveAttendance" ADD CONSTRAINT "LiveAttendance_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveAttendance" ADD CONSTRAINT "LiveAttendance_gymId_memberId_fkey" FOREIGN KEY ("gymId", "memberId") REFERENCES "Member"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveAttendance" ADD CONSTRAINT "LiveAttendance_gymId_staffId_fkey" FOREIGN KEY ("gymId", "staffId") REFERENCES "StaffMember"("gymId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════ Live sessions: checks, row-level security, webhook writes ═══════════════════════════

-- Only an online class may have no room; PT sessions are in person or online, never hybrid.
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_room_unless_online" CHECK ("roomId" IS NOT NULL OR "deliveryMode" = 'ONLINE');
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_delivery" CHECK ("deliveryMode" <> 'HYBRID');

ALTER TABLE "LiveAttendance" ADD CONSTRAINT "LiveAttendance_values" CHECK (
  num_nonnulls("memberId", "staffId") = 1 AND seconds >= 0
  AND ("lastLeftAt" IS NULL OR "lastLeftAt" >= "firstJoinedAt"));

ALTER TABLE "LiveAttendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LiveAttendance" FORCE ROW LEVEL SECURITY;
CREATE TRIGGER "LiveAttendance_gym_immutable" BEFORE UPDATE ON "LiveAttendance" FOR EACH ROW EXECUTE FUNCTION forbid_gym_change();
-- Staff see who joined (like the schedule itself); members see their own. No write policies:
-- rows are written only by app_record_live_event() below.
CREATE POLICY tenant_read ON "LiveAttendance" FOR SELECT USING ("gymId" = app_current_gym_id() AND (SELECT app_can_access_current_gym()));
CREATE POLICY member_own_read ON "LiveAttendance" FOR SELECT USING ("gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));

-- Record a LiveKit webhook event. The webhook has no signed-in user, so this runs as the owner;
-- the app has verified the webhook's signature first. The room name and identity come from tokens
-- this app issued, and are checked again here: the session must be an online one in that gym,
-- and the member or staff member must belong to it. Repeated or out-of-order events are harmless.
--   p_event: 'joined' | 'left' | 'finished' (room closed: everyone still connected leaves)
CREATE FUNCTION app_record_live_event(p_gym_id text, p_kind "LiveRoomKind", p_session_id text, p_identity text, p_event text, p_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
DECLARE
  v_member text;
  v_staff text;
BEGIN
  IF p_kind = 'CLASS' THEN
    PERFORM 1 FROM "ClassSession" WHERE id = p_session_id AND "gymId" = p_gym_id AND "deliveryMode" <> 'IN_PERSON';
  ELSE
    PERFORM 1 FROM "TrainingSession" WHERE id = p_session_id AND "gymId" = p_gym_id AND "deliveryMode" = 'ONLINE';
  END IF;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_event = 'finished' THEN
    UPDATE "LiveAttendance"
       SET seconds = seconds + GREATEST(0, floor(extract(epoch FROM p_at - "connectedAt")))::int,
           "connectedAt" = NULL, "lastLeftAt" = GREATEST(p_at, "firstJoinedAt"), "updatedAt" = now()
     WHERE "gymId" = p_gym_id AND kind = p_kind AND "sessionId" = p_session_id AND "connectedAt" IS NOT NULL;
    RETURN true;
  END IF;

  IF p_identity LIKE 'm\_%' THEN
    SELECT id INTO v_member FROM "Member" WHERE id = substr(p_identity, 3) AND "gymId" = p_gym_id;
  ELSIF p_identity LIKE 's\_%' THEN
    SELECT id INTO v_staff FROM "StaffMember" WHERE id = substr(p_identity, 3) AND "gymId" = p_gym_id;
  END IF;
  IF v_member IS NULL AND v_staff IS NULL THEN RETURN false; END IF;

  IF p_event = 'joined' THEN
    IF v_member IS NOT NULL THEN
      INSERT INTO "LiveAttendance" (id, "gymId", kind, "sessionId", "memberId", "firstJoinedAt", "connectedAt", "updatedAt")
      VALUES (gen_random_uuid()::text, p_gym_id, p_kind, p_session_id, v_member, p_at, p_at, now())
      ON CONFLICT ("gymId", kind, "sessionId", "memberId") DO UPDATE
        SET "connectedAt" = COALESCE("LiveAttendance"."connectedAt", EXCLUDED."connectedAt"),
            "firstJoinedAt" = LEAST("LiveAttendance"."firstJoinedAt", EXCLUDED."firstJoinedAt"), "updatedAt" = now();
    ELSE
      INSERT INTO "LiveAttendance" (id, "gymId", kind, "sessionId", "staffId", "firstJoinedAt", "connectedAt", "updatedAt")
      VALUES (gen_random_uuid()::text, p_gym_id, p_kind, p_session_id, v_staff, p_at, p_at, now())
      ON CONFLICT ("gymId", kind, "sessionId", "staffId") DO UPDATE
        SET "connectedAt" = COALESCE("LiveAttendance"."connectedAt", EXCLUDED."connectedAt"),
            "firstJoinedAt" = LEAST("LiveAttendance"."firstJoinedAt", EXCLUDED."firstJoinedAt"), "updatedAt" = now();
    END IF;
    RETURN true;
  ELSIF p_event = 'left' THEN
    UPDATE "LiveAttendance"
       SET seconds = seconds + GREATEST(0, floor(extract(epoch FROM p_at - "connectedAt")))::int,
           "connectedAt" = NULL, "lastLeftAt" = GREATEST(p_at, "firstJoinedAt"), "updatedAt" = now()
     WHERE "gymId" = p_gym_id AND kind = p_kind AND "sessionId" = p_session_id AND "connectedAt" IS NOT NULL
       AND ("memberId" = v_member OR "staffId" = v_staff);
    RETURN true;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION app_record_live_event(text, "LiveRoomKind", text, text, text, timestamptz) FROM PUBLIC;
