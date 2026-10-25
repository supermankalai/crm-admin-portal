import "server-only";
import { withUser } from "@/server/db/context";

/** Gyms the user is active staff of. RLS limits StaffMember to the user's own rows here. */
export async function listMyGyms(userId: string) {
  return withUser(userId, (tx) =>
    tx.staffMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: {
        role: true,
        gym: { select: { id: true, slug: true, name: true, status: true, brandColor: true } },
      },
      orderBy: { gym: { name: "asc" } },
    })
  );
}
