import { redirect } from "next/navigation";
import { requireGymAccess } from "@/server/tenant";

export default async function GymIndex({ params }: { params: Promise<{ gymSlug: string }> }) {
  const ctx = await requireGymAccess((await params).gymSlug);
  redirect(`/g/${ctx.gym.slug}/dashboard`);
}
