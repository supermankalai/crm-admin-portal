import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { listMyGyms } from "@/server/services/my-gyms";

/** After login: super admins → platform area; one gym → its dashboard; otherwise the gym picker. */
export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.isSuperAdmin) redirect("/admin");
  const gyms = await listMyGyms(user.id);
  if (gyms.length === 1) redirect(`/g/${gyms[0].gym.slug}/dashboard`);
  redirect("/select-gym");
}
