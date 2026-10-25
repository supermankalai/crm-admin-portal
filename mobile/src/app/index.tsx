import { Redirect, type Href } from "expo-router";
import { useSession } from "@/hooks/use-session";
import { homeTab } from "@/nav/tabs";

/**
 * The app's root address ("/": fitcrm:///, which is how a development build opens the app):
 * send each person where they belong. The root layout's protected groups decide what's
 * reachable; this only picks the starting screen.
 */
export default function Index() {
  const s = useSession();
  if (s.phase === "signedOut") return <Redirect href="/login" />;
  if (!s.gym) return <Redirect href="/select-gym" />;
  return <Redirect href={`/${homeTab(s.gym.role)}` as Href} />;
}
