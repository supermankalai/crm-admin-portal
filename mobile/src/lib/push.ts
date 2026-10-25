import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import type * as NotificationsModule from "expo-notifications";
import { Platform } from "react-native";
import { log } from "./log";
import { api } from "./session";
import { parseLiveLink, type LiveLink } from "./live";

/**
 * Push alerts. The server decides what to send (and only ever sends generic text — details are in
 * the inbox, behind sign-in); this registers the device's Expo push token for the selected gym and
 * routes a tapped alert to the inbox.
 *
 * Push needs a real device and a development or store build. Android builds that include
 * Firebase (google-services.json, see app.config) register their native Firebase token and the
 * server sends straight through Firebase; otherwise the device registers an Expo token, which
 * needs the EAS project id (EAS_PROJECT_ID).
 * Expo Go on Android doesn't include push at all since SDK 53 — even importing expo-notifications
 * there crashes (its native module is missing) — so the module is only ever loaded through
 * `notifications()` below, which returns null where it isn't available. Everything else, including
 * the in-app inbox, works the same without it.
 */

type Notifications = typeof NotificationsModule;
export type NotificationResponse = NotificationsModule.NotificationResponse;
export type PushStatus = "registered" | "not-asked" | "denied" | "unavailable";

const inExpoGoOnAndroid = Platform.OS === "android" && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
let loaded: Notifications | null | undefined;

/** expo-notifications, loaded on first use — or null where this build can't use it. */
function notifications(): Notifications | null {
  if (loaded !== undefined) return loaded;
  if (inExpoGoOnAndroid) return (loaded = null);
  try {
    // Deliberately lazy (not a top-level import): see the comment at the top of this file.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require("expo-notifications") as Notifications;
  } catch {
    loaded = null;
  }
  return loaded;
}

export function configurePushHandling() {
  // While the app is open, still show the banner (the inbox badge updates too).
  notifications()?.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? null;
}

/** Firebase directly (Android builds with google-services.json), or Expo's push service. */
export function pushTransport(): "fcm" | "expo" {
  const extra = Constants.expoConfig?.extra as { pushTransport?: string } | undefined;
  return Platform.OS === "android" && extra?.pushTransport === "fcm" ? "fcm" : "expo";
}

export function pushAvailable() {
  return Device.isDevice && !!notifications() && (pushTransport() === "fcm" || !!projectId());
}

export async function pushPermission(): Promise<"granted" | "not-asked" | "denied"> {
  const n = notifications();
  if (!n) return "not-asked";
  const p = await n.getPermissionsAsync();
  return p.granted ? "granted" : p.canAskAgain ? "not-asked" : "denied";
}

/**
 * Register this device for the current gym. With ask=false it never shows the system prompt
 * (used silently after sign-in); the settings screen asks when the person chooses to.
 */
export async function registerForPush({ ask }: { ask: boolean }): Promise<PushStatus> {
  const id = projectId();
  const n = notifications();
  const transport = pushTransport();
  if (!Device.isDevice || !n || (transport === "expo" && !id)) return "unavailable";
  try {
    if (Platform.OS === "android") {
      await n.setNotificationChannelAsync("default", { name: "Gym alerts", importance: n.AndroidImportance.HIGH });
    }
    let perm = await n.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain && ask) perm = await n.requestPermissionsAsync();
    if (!perm.granted) return perm.canAskAgain ? "not-asked" : "denied";
    const platform = Platform.OS === "ios" ? "ios" : "android";
    if (transport === "fcm") {
      // The device's own Firebase registration token (Android).
      const device = await n.getDevicePushTokenAsync();
      await api.call("registerPushToken", { body: { token: String(device.data), platform, provider: "fcm" } });
    } else {
      const { data } = await n.getExpoPushTokenAsync({ projectId: id! });
      await api.call("registerPushToken", { body: { token: data, platform, provider: "expo" } });
    }
    return "registered";
  } catch {
    // No network, or Google services missing: the inbox still works.
    log.warn("push registration unavailable");
    return "unavailable";
  }
}

/** Call `handler` for an alert the person tapped (including the one that opened the app). */
export function onAlertTapped(handler: (response: NotificationResponse) => void): () => void {
  const n = notifications();
  if (!n) return () => undefined;
  const last = n.getLastNotificationResponse();
  if (last) handler(last);
  const sub = n.addNotificationResponseReceivedListener(handler);
  return () => sub.remove();
}

/** On sign-out: alerts already on screen belong to the person who's leaving. */
export async function dismissDeliveredAlerts() {
  await notifications()
    ?.dismissAllNotificationsAsync()
    .catch(() => undefined);
}

/** The gym a tapped alert belongs to (to switch first if it's another gym). */
export function gymOfResponse(response: NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as { gymSlug?: unknown } | undefined;
  return typeof data?.gymSlug === "string" ? data.gymSlug : null;
}

/** The call a tapped "starts soon" alert points at, if any. */
export function liveOfResponse(response: NotificationResponse | null): LiveLink | null {
  const data = response?.notification.request.content.data as { live?: unknown } | undefined;
  return parseLiveLink(data?.live);
}

const handled = new Set<string>();

/** True the first time a tapped alert is seen (the cold-start response is reported repeatedly). */
export function firstTimeHandled(response: NotificationResponse) {
  const id = response.notification.request.identifier;
  if (handled.has(id)) return false;
  handled.add(id);
  return true;
}
