import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false, headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="otp" options={{ title: "Sign in with a code" }} />
      <Stack.Screen name="invite" options={{ title: "Join your gym" }} />
    </Stack>
  );
}
