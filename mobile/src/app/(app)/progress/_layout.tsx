import { Stack } from "expo-router";

export default function ProgressLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="log" options={{ title: "Log measurements", presentation: "modal" }} />
      <Stack.Screen name="photo" options={{ title: "Progress photo" }} />
    </Stack>
  );
}
