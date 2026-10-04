import { Stack } from "expo-router";

export default function CardLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="membership" options={{ title: "My membership" }} />
    </Stack>
  );
}
