import { Stack } from "expo-router";

export default function PlansLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[planId]" options={{ title: "Plan" }} />
      <Stack.Screen name="edit" options={{ title: "Workout plan", presentation: "modal" }} />
      <Stack.Screen name="assign" options={{ title: "Give to a client", presentation: "modal" }} />
    </Stack>
  );
}
