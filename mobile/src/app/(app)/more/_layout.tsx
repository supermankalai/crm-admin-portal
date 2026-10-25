import { Stack } from "expo-router";

export default function MoreLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="security" options={{ title: "App lock" }} />
      <Stack.Screen name="devices" options={{ title: "Your devices" }} />
      <Stack.Screen name="password" options={{ title: "Change password" }} />
      <Stack.Screen name="attendance" options={{ title: "Attendance" }} />
      <Stack.Screen name="payments" options={{ title: "Payments & invoices" }} />
      <Stack.Screen name="invoice/[invoiceId]" options={{ title: "Invoice" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="notification-settings" options={{ title: "Alerts on this phone" }} />
      <Stack.Screen name="announcements" options={{ title: "Announcements" }} />
      <Stack.Screen name="profile" options={{ title: "My details" }} />
      <Stack.Screen name="delete-account" options={{ title: "Delete my account", presentation: "modal" }} />
    </Stack>
  );
}
