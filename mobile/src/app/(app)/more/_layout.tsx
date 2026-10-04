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
    </Stack>
  );
}
