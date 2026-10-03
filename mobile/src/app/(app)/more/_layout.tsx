import { Stack } from "expo-router";

export default function MoreLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="security" options={{ title: "App lock" }} />
      <Stack.Screen name="devices" options={{ title: "Your devices" }} />
      <Stack.Screen name="password" options={{ title: "Change password" }} />
    </Stack>
  );
}
