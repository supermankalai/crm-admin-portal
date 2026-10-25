/**
 * Expo Go on Android has no push module since SDK 53: loading expo-notifications there throws
 * ("Cannot find native module 'ExpoTopicSubscriptionModule'") and took the whole app down. The push
 * helpers must never load it there, and everything else must keep working.
 */

jest.mock("expo-constants", () => ({
  __esModule: true,
  ExecutionEnvironment: { Bare: "bare", Standalone: "standalone", StoreClient: "storeClient" },
  default: { executionEnvironment: "storeClient", expoConfig: { extra: { eas: { projectId: "project-id" } } } },
}));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-notifications", () => {
  throw new Error("Cannot find native module 'ExpoTopicSubscriptionModule'");
});
jest.mock("@/lib/session", () => ({ api: { call: jest.fn() } }));

describe("push helpers in Expo Go on Android", () => {
  it("never load expo-notifications and report push as unavailable", async () => {
    // Load order matters: Platform must say Android before the push module is evaluated.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { Platform } = require("react-native") as typeof import("react-native");
    Object.defineProperty(Platform, "OS", { get: () => "android" });
    const push = require("@/lib/push") as typeof import("@/lib/push");
    /* eslint-enable @typescript-eslint/no-require-imports */
    expect(() => push.configurePushHandling()).not.toThrow();
    expect(push.pushAvailable()).toBe(false);
    await expect(push.registerForPush({ ask: true })).resolves.toBe("unavailable");
    await expect(push.pushPermission()).resolves.toBe("not-asked");
    const stop = push.onAlertTapped(() => undefined);
    expect(() => stop()).not.toThrow();
    await expect(push.dismissDeliveredAlerts()).resolves.toBeUndefined();
  });
});
