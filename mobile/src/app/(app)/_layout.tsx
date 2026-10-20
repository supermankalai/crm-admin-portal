import { useEffect } from "react";
import { Tabs, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useBrand } from "@/hooks/use-brand";
import { useSession } from "@/hooks/use-session";
import { useUnreadCount } from "@/lib/inbox-queries";
import { firstTimeHandled, gymOfResponse, onAlertTapped, registerForPush, type NotificationResponse } from "@/lib/push";
import { selectGym, session } from "@/lib/session";
import { ALL_TABS, routesFor, TAB_META, tabsFor } from "@/nav/tabs";

/**
 * Bottom tabs change with the role in the selected gym. Other roles' tabs are protected routes:
 * not shown and not reachable by deep link. (The server checks every request anyway.)
 */
export default function AppTabs() {
  const { gym } = useSession();
  const { brand } = useBrand();
  const router = useRouter();
  const visible = tabsFor(gym?.role);
  const allowed = routesFor(gym?.role);
  const unread = useUnreadCount();
  const slug = gym?.slug;

  // Register this device for push in the selected gym (silently: never prompts here).
  useEffect(() => {
    if (slug) void registerForPush({ ask: false });
  }, [slug]);

  // A tapped alert opens the inbox — of its own gym, switching first if needed.
  useEffect(() => {
    const open = async (response: NotificationResponse) => {
      if (!firstTimeHandled(response)) return;
      const target = gymOfResponse(response);
      // The payload is untrusted: only switch to a gym this person can actually use.
      if (target && target !== slug && session.getState().gyms.some((g) => g.slug === target && g.appAccess.allowed)) await selectGym(target).catch(() => undefined);
      router.push("/more/notifications");
    };
    return onAlertTapped((r) => void open(r));
  }, [router, slug]);
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: brand, tabBarLabelStyle: { fontSize: 12 } }}>
      {ALL_TABS.map((key) => (
        <Tabs.Protected key={key} guard={allowed.includes(key)}>
          <Tabs.Screen
            name={key}
            options={{
              title: TAB_META[key].title,
              // Allowed but without a tab button (e.g. check-in for owners, opened from the dashboard).
              href: visible.includes(key) ? undefined : null,
              tabBarAccessibilityLabel: key === "more" && unread ? `${TAB_META[key].title}, ${unread} unread notifications` : TAB_META[key].title,
              tabBarBadge: key === "more" && unread ? (unread > 99 ? "99+" : unread) : undefined,
              tabBarIcon: ({ color, focused, size }) => (
                <Ionicons name={(focused ? TAB_META[key].iconActive : TAB_META[key].icon) as keyof typeof Ionicons.glyphMap} size={size} color={color} />
              ),
            }}
          />
        </Tabs.Protected>
      ))}
    </Tabs>
  );
}
