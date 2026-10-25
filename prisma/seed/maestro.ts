import type { PrismaClient } from "@/generated/prisma/client";
import { at, dateOnly, id } from "./lib";

/**
 * Fixed classes and bookings the Maestro end-to-end flows (mobile/.maestro) rely on, at Iron Temple.
 * Re-running `npm run db:seed` resets them, so the flows can run again.
 *
 *   "Maestro Open Class"        tomorrow 18:00, 20 spots, nobody booked   → member1 books it
 *   "Maestro Full Class"        tomorrow 19:00, 1 spot, member2 booked    → member1 joins the waitlist
 *   "Maestro Attendance Class"  started 2 h before seeding, taught by trainer1, member1 and member2
 *                               booked                                    → trainer1 marks attendance
 * member1 and member2 are given a membership if none covers today and tomorrow (the classes' days).
 */
export async function seedMaestroFixtures(db: PrismaClient) {
  const gym = await db.gym.findUniqueOrThrow({ where: { slug: "iron-temple" }, select: { id: true } });
  const gymId = gym.id;
  const accounts = await db.memberAccount.findMany({
    where: { gymId, user: { email: { in: ["member1@irontemple.example", "member2@irontemple.example"] } } },
    select: { memberId: true, user: { select: { email: true } } },
  });
  const memberOf = (email: string) => accounts.find((a) => a.user.email === email)!.memberId;
  const member1 = memberOf("member1@irontemple.example");
  const member2 = memberOf("member2@irontemple.example");
  const trainer1 = await db.staffMember.findFirstOrThrow({ where: { gymId, user: { email: "trainer1@irontemple.example" } }, select: { id: true } });
  const room = await db.room.findFirstOrThrow({ where: { gymId }, orderBy: { name: "asc" }, select: { id: true } });
  const plan = await db.membershipPlan.findFirstOrThrow({ where: { gymId, type: "MONTHLY", isActive: true }, select: { id: true, priceMinor: true } });

  for (const memberId of [member1, member2]) {
    const current = await db.membership.findFirst({
      where: { memberId, status: "ACTIVE", startDate: { lte: dateOnly(0) }, endDate: { gte: dateOnly(1) }, freezes: { none: { startDate: { lte: dateOnly(0) }, endDate: { gte: dateOnly(0) } } } },
      select: { id: true },
    });
    if (!current) {
      await db.membership.create({ data: { id: id(), gymId, memberId, planId: plan.id, startDate: dateOnly(-1), endDate: dateOnly(29), priceMinor: plan.priceMinor } });
    }
  }

  // A class shows its class type's name in the app, so each fixture gets its own type.
  const named = async (name: string) =>
    (await db.classType.create({ data: { gymId, name, color: "#0ea5e9", durationMinutes: 60, defaultCapacity: 20 }, select: { id: true } })).id;
  const openType = await named("Maestro Open Class");
  const fullType = await named("Maestro Full Class");
  const attendanceType = await named("Maestro Attendance Class");

  const mk = async (classTypeId: string, startsAt: Date, capacity: number, trainerId: string) =>
    (await db.classSession.create({ data: { gymId, classTypeId, trainerId, roomId: room.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), capacity }, select: { id: true } })).id;

  await mk(openType, at(1, 18), 20, trainer1.id);
  const full = await mk(fullType, at(1, 19), 1, trainer1.id);
  await db.booking.create({ data: { gymId, sessionId: full, memberId: member2, status: "BOOKED" } });
  const attendance = await mk(attendanceType, new Date(Date.now() - 2 * 3_600_000), 20, trainer1.id);
  await db.booking.createMany({
    data: [
      { gymId, sessionId: attendance, memberId: member1, status: "BOOKED" },
      { gymId, sessionId: attendance, memberId: member2, status: "BOOKED" },
    ],
  });
}
