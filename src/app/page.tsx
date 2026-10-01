import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";

export default async function HomePage() {
  redirect((await getSessionUser()) ? "/select-gym" : "/login");
}
