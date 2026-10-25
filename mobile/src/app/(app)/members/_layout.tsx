import { Stack } from "expo-router";

export default function MembersLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[memberId]" options={{ title: "Member" }} />
      <Stack.Screen name="new" options={{ title: "Add member", presentation: "modal" }} />
      <Stack.Screen name="pay" options={{ title: "Record payment", presentation: "modal" }} />
      <Stack.Screen name="sell" options={{ title: "Sell membership", presentation: "modal" }} />
    </Stack>
  );
}
