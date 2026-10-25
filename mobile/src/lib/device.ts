import * as Application from "expo-application";
import * as Device from "expo-device";
import { Platform } from "react-native";

/** What the server records for this device session (shown in "Your devices"). */
export function deviceInfo() {
  const platform = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";
  return {
    name: (Device.deviceName ?? Device.modelName ?? `${platform} device`).slice(0, 100),
    platform: platform as "ios" | "android" | "web",
    appVersion: Application.nativeApplicationVersion ?? undefined,
  };
}
