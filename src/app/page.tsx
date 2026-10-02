import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { listMyGyms } from "@/server/services/my-gyms";

/** After login: straight into the gym when the user has exactly one, otherwise the gym picker. */
export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const gyms = await listMyGyms(user.id);
  if (gyms.length === 1 && !user.isSuperAdmin) redirect(`/g/${gyms[0].gym.slug}/dashboard`);
  redirect("/select-gym");
}
