import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { log } from "./log";
import { api } from "./session";

/**
 * Push alerts. The server decides what to send (and only ever sends generic text — details are in
 * the inbox, behind sign-in); this registers the device's Expo push token for the selected gym and
 * routes a tapped alert to the inbox.
 *
 * Push needs a real device and the EAS project id (EAS_PROJECT_ID, set up in Phase 7). Expo Go on
 * Android can't receive remote push since SDK 53 — use a development build for that. Everywhere
 * else the in-app inbox works the same.
 */

export type PushStatus = "registered" | "not-asked" | "denied" | "unavailable";

export function configurePushHandling() {
  // While the app is open, still show the banner (the inbox badge updates too).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? null;
}

export function pushAvailable() {
  return Device.isDevice && !!projectId();
}

export async function pushPermission(): Promise<"granted" | "not-asked" | "denied"> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? "granted" : p.canAskAgain ? "not-asked" : "denied";
}

/**
 * Register this device for the current gym. With ask=false it never shows the system prompt
 * (used silently after sign-in); the settings screen asks when the person chooses to.
 */
export async function registerForPush({ ask }: { ask: boolean }): Promise<PushStatus> {
  const id = projectId();
  if (!Device.isDevice || !id) return "unavailable";
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "Gym alerts", importance: Notifications.AndroidImportance.HIGH });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain && ask) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return perm.canAskAgain ? "not-asked" : "denied";
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await api.call("registerPushToken", { body: { token: data, platform: Platform.OS === "ios" ? "ios" : "android" } });
    return "registered";
  } catch {
    // Expo Go on Android, no network, or Google services missing: the inbox still works.
    log.warn("push registration unavailable");
    return "unavailable";
  }
}

/** The gym a tapped alert belongs to (to switch first if it's another gym). */
export function gymOfResponse(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as { gymSlug?: unknown } | undefined;
  return typeof data?.gymSlug === "string" ? data.gymSlug : null;
}

const handled = new Set<string>();

/** True the first time a tapped alert is seen (the cold-start response is reported repeatedly). */
export function firstTimeHandled(response: Notifications.NotificationResponse) {
  const id = response.notification.request.identifier;
  if (handled.has(id)) return false;
  handled.add(id);
  return true;
}
