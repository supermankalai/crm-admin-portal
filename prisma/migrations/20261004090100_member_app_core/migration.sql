-- AlterTable
ALTER TABLE "Gym" ADD COLUMN     "acceptStaticCheckInCodes" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "memberBookingDaysAhead" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "memberCancelHours" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "Gym"
  ADD CONSTRAINT "Gym_member_booking_rules" CHECK ("memberBookingDaysAhead" BETWEEN 1 AND 60 AND "memberCancelHours" BETWEEN 0 AND 72);

-- ═══════════════════════════ Member app: data access ═══════════════════════════
-- In a member context (app_current_member_id() resolves to the signed-in user's own ACTIVE member
-- account in the current gym) a member may read their own records and the gym's public catalog.
-- Nothing else: other members, staff, notes, reports and audit stay invisible.

CREATE FUNCTION app_is_member_context() RETURNS boolean
LANGUAGE sql STABLE SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT app_current_gym_id() IS NOT NULL AND (SELECT app_current_member_id()) IS NOT NULL
$$;

-- Own records.
CREATE POLICY member_own_read ON "Membership" FOR SELECT USING ("gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));
CREATE POLICY member_own_read ON "Booking" FOR SELECT USING ("gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));
CREATE POLICY member_own_read ON "Invoice" FOR SELECT USING ("gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()) AND "deletedAt" IS NULL);
CREATE POLICY member_own_read ON "Payment" FOR SELECT USING ("gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()) AND "deletedAt" IS NULL);
CREATE POLICY member_own_read ON "CheckIn" FOR SELECT USING ("gymId" = app_current_gym_id() AND "memberId" = (SELECT app_current_member_id()));
CREATE POLICY member_own_read ON "MembershipFreeze" FOR SELECT USING (
  "gymId" = app_current_gym_id()
  AND EXISTS (SELECT 1 FROM "Membership" ms WHERE ms.id = "membershipId" AND ms."memberId" = (SELECT app_current_member_id())));
CREATE POLICY member_own_read ON "Refund" FOR SELECT USING (
  "gymId" = app_current_gym_id()
  AND EXISTS (SELECT 1 FROM "Payment" p WHERE p.id = "paymentId" AND p."memberId" = (SELECT app_current_member_id())));

-- The gym's catalog: plans, class types, the class timetable, rooms, locations.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MembershipPlan', 'ClassType', 'ClassSession', 'Room', 'Location', 'OpeningHours'] LOOP
    EXECUTE format('CREATE POLICY member_catalog_read ON %I FOR SELECT USING ("gymId" = app_current_gym_id() AND (SELECT app_is_member_context()))', t);
  END LOOP;
END $$;

-- ═══════════════════════ Member app: booking actions ═══════════════════════
-- Booking or cancelling a class runs the same booking service as staff use. During that one
-- action (app.member_action = on, set only by the server's member-action wrapper, and valid only
-- with a verified member context) the transaction may touch the class's bookings and members'
-- class-pack credits — waitlist promotion moves other people up — but nothing else.

CREATE FUNCTION app_is_member_action() RETURNS boolean
LANGUAGE sql STABLE SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT (SELECT app_is_member_context()) AND coalesce(current_setting('app.member_action', true), '') = 'on'
$$;

CREATE POLICY member_action_read ON "Booking" FOR SELECT USING ("gymId" = app_current_gym_id() AND (SELECT app_is_member_action()));
CREATE POLICY member_action_insert ON "Booking" FOR INSERT WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_member_action()));
CREATE POLICY member_action_update ON "Booking" FOR UPDATE
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_member_action()))
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_member_action()));
CREATE POLICY member_action_read ON "Membership" FOR SELECT USING ("gymId" = app_current_gym_id() AND (SELECT app_is_member_action()));
CREATE POLICY member_action_update ON "Membership" FOR UPDATE
  USING ("gymId" = app_current_gym_id() AND (SELECT app_is_member_action()))
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_member_action()));
CREATE POLICY member_action_read ON "MembershipFreeze" FOR SELECT USING ("gymId" = app_current_gym_id() AND (SELECT app_is_member_action()));
-- Member actions are audited as the member, never as staff.
CREATE POLICY member_action_insert ON "AuditLog" FOR INSERT
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_is_member_action()) AND "actorType" = 'MEMBER' AND "actorUserId" = app_current_user_id());

-- Outside staff contexts, a membership can only gain or lose one class credit at a time — nothing
-- else about it can change (defence in depth for the member booking path).
CREATE FUNCTION membership_non_staff_update_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = "gym-admin-portal", pg_temp AS $$
BEGIN
  IF app_current_gym_id() IS NULL OR (SELECT app_is_staff_of_current_gym()) THEN
    RETURN NEW; -- owner role (seed, jobs) or real staff
  END IF;
  IF (to_jsonb(NEW) - 'classCreditsRemaining' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'classCreditsRemaining' - 'updatedAt')
     OR abs(coalesce(NEW."classCreditsRemaining", 0) - coalesce(OLD."classCreditsRemaining", 0)) <> 1 THEN
    RAISE EXCEPTION 'membership can only change by one class credit here' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Membership_non_staff_update_guard" BEFORE UPDATE ON "Membership"
  FOR EACH ROW EXECUTE FUNCTION membership_non_staff_update_guard();

-- The class timetable for members: sessions with spot counts and the trainer's name, without
-- exposing anyone's bookings or staff records.
CREATE FUNCTION member_class_schedule(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (id text, starts_at timestamptz, ends_at timestamptz, status text, capacity integer,
               class_name text, class_color text, class_description text, room_name text, location_name text,
               trainer_name text, booked integer, waitlisted integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT s.id, s."startsAt", s."endsAt", s.status::text, s.capacity,
         ct.name, ct.color, ct.description, r.name, l.name, u.name,
         (SELECT count(*) FROM "Booking" b WHERE b."sessionId" = s.id AND b.status IN ('BOOKED', 'ATTENDED', 'NO_SHOW'))::int,
         (SELECT count(*) FROM "Booking" b WHERE b."sessionId" = s.id AND b.status = 'WAITLISTED')::int
    FROM "ClassSession" s
    JOIN "ClassType" ct ON ct.id = s."classTypeId"
    JOIN "Room" r ON r.id = s."roomId"
    JOIN "Location" l ON l.id = r."locationId"
    JOIN "StaffMember" st ON st.id = s."trainerId"
    JOIN "User" u ON u.id = st."userId"
   WHERE s."gymId" = app_current_gym_id()
     AND ((SELECT app_is_member_context()) OR (SELECT app_is_staff_of_current_gym()))
     AND s."startsAt" >= p_from AND s."startsAt" < p_to
     AND p_to - p_from <= interval '62 days'
   ORDER BY s."startsAt", ct.name
$$;
REVOKE ALL ON FUNCTION member_class_schedule(timestamptz, timestamptz) FROM PUBLIC;

