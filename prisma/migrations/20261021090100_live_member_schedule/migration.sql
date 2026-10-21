-- The member timetable includes online classes (no room) and says how each class is delivered.
-- The return type changes, so the function is dropped and recreated.
DROP FUNCTION member_class_schedule(timestamptz, timestamptz);

CREATE FUNCTION member_class_schedule(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (id text, starts_at timestamptz, ends_at timestamptz, status text, capacity integer,
               class_name text, class_color text, class_description text, room_name text, location_name text,
               trainer_name text, booked integer, waitlisted integer, delivery_mode text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal", pg_temp AS $$
  SELECT s.id, s."startsAt", s."endsAt", s.status::text, s.capacity,
         ct.name, ct.color, ct.description, r.name, l.name, u.name,
         (SELECT count(*) FROM "Booking" b WHERE b."sessionId" = s.id AND b.status IN ('BOOKED', 'ATTENDED', 'NO_SHOW'))::int,
         (SELECT count(*) FROM "Booking" b WHERE b."sessionId" = s.id AND b.status = 'WAITLISTED')::int,
         s."deliveryMode"::text
    FROM "ClassSession" s
    JOIN "ClassType" ct ON ct.id = s."classTypeId"
    LEFT JOIN "Room" r ON r.id = s."roomId"
    LEFT JOIN "Location" l ON l.id = r."locationId"
    JOIN "StaffMember" st ON st.id = s."trainerId"
    JOIN "User" u ON u.id = st."userId"
   WHERE s."gymId" = app_current_gym_id()
     AND ((SELECT app_is_member_context()) OR (SELECT app_is_staff_of_current_gym()))
     AND s."startsAt" >= p_from AND s."startsAt" < p_to
     AND p_to - p_from <= interval '62 days'
   ORDER BY s."startsAt", ct.name
$$;
REVOKE ALL ON FUNCTION member_class_schedule(timestamptz, timestamptz) FROM PUBLIC;
