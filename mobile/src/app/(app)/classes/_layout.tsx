import { Stack } from "expo-router";

export default function ClassesLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[sessionId]" options={{ title: "Class" }} />
    </Stack>
  );
}
