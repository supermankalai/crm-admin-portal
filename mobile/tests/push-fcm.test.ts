/**
 * Android builds that include Firebase (google-services.json → extra.pushTransport "fcm") register
 * the device's own Firebase token, and need no Expo project id.
 */

jest.mock("expo-constants", () => ({
  __esModule: true,
  ExecutionEnvironment: { Bare: "bare", Standalone: "standalone", StoreClient: "storeClient" },
  // A development build (not Expo Go), with Firebase and without an EAS project id.
  default: { executionEnvironment: "bare", expoConfig: { extra: { pushTransport: "fcm" } } },
}));
jest.mock("expo-device", () => ({ isDevice: true }));
const mockNotifications = {
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: "android", data: "fcm-device-token" })),
  getExpoPushTokenAsync: jest.fn(),
  AndroidImportance: { HIGH: 4 },
};
jest.mock("expo-notifications", () => mockNotifications);
const mockCall = jest.fn(async () => ({ ok: true }));
jest.mock("@/lib/session", () => ({ api: { call: mockCall } }));

describe("push on an Android build with Firebase", () => {
  it("registers the device's Firebase token", async () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { Platform } = require("react-native") as typeof import("react-native");
    Object.defineProperty(Platform, "OS", { get: () => "android" });
    const push = require("@/lib/push") as typeof import("@/lib/push");
    /* eslint-enable @typescript-eslint/no-require-imports */
    expect(push.pushTransport()).toBe("fcm");
    expect(push.pushAvailable()).toBe(true);
    await expect(push.registerForPush({ ask: false })).resolves.toBe("registered");
    expect(mockNotifications.setNotificationChannelAsync).toHaveBeenCalledWith("default", expect.objectContaining({ name: "Gym alerts" }));
    expect(mockNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockCall).toHaveBeenCalledWith("registerPushToken", { body: { token: "fcm-device-token", platform: "android", provider: "fcm" } });
  });
});
