import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useBrand } from "@/hooks/use-brand";
import { useSession } from "@/hooks/use-session";
import { ALL_TABS, TAB_META, tabsFor } from "@/nav/tabs";

/**
 * Bottom tabs change with the role in the selected gym. Other roles' tabs are protected routes:
 * not shown and not reachable by deep link. (The server checks every request anyway.)
 */
export default function AppTabs() {
  const { gym } = useSession();
  const { brand } = useBrand();
  const visible = tabsFor(gym?.role);
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: brand, tabBarLabelStyle: { fontSize: 12 } }}>
      {ALL_TABS.map((key) => (
        <Tabs.Protected key={key} guard={visible.includes(key)}>
          <Tabs.Screen
            name={key}
            options={{
              title: TAB_META[key].title,
              tabBarAccessibilityLabel: TAB_META[key].title,
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
