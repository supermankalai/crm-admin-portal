import { Stack } from "expo-router";

export default function ClientsLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[memberId]" options={{ title: "Client" }} />
      <Stack.Screen name="session" options={{ title: "Book a PT session", presentation: "modal" }} />
    </Stack>
  );
}
