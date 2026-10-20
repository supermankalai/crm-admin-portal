import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * One config, three environments (APP_ENV = development | staging | production, set per EAS
 * build profile or in your shell). Only public values go in here: the API URL and identifiers.
 * There are no secrets in the app bundle.
 */
// On EAS every build profile sets APP_ENV (eas.json). Refuse to build without it rather than
// silently producing a development build (plain HTTP allowed) for a store or tester release.
if (process.env.EAS_BUILD === "true" && !process.env.APP_ENV) throw new Error("APP_ENV must be set for EAS builds (see eas.json).");
const APP_ENV = (process.env.APP_ENV ?? "development") as "development" | "staging" | "production";
if (!["development", "staging", "production"].includes(APP_ENV)) throw new Error(`Unknown APP_ENV "${APP_ENV}".`);
const suffix = APP_ENV === "production" ? "" : `.${APP_ENV === "staging" ? "staging" : "dev"}`;
const nameSuffix = APP_ENV === "production" ? "" : APP_ENV === "staging" ? " (Staging)" : " (Dev)";
const androidPackage = `com.kangagympilot.member${suffix}`;

/**
 * Android push through Firebase: the build includes google-services.json (default
 * ../firebase/google-services.json, or GOOGLE_SERVICES_JSON) only if it has an Android app for
 * this build's package. Otherwise the build still works, with push turned off, and says why.
 * The file holds public client identifiers, not secrets.
 */
function googleServicesFor(pkg: string): string | null {
  const file = path.resolve(__dirname, process.env.GOOGLE_SERVICES_JSON ?? "../firebase/google-services.json");
  if (!existsSync(file)) return null;
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as { client?: { client_info?: { android_client_info?: { package_name?: string } } }[] };
    if (json.client?.some((c) => c.client_info?.android_client_info?.package_name === pkg)) return path.relative(__dirname, file).split(path.sep).join("/");
    console.warn(`[app.config] ${path.basename(file)} has no Android app "${pkg}". Add it in the Firebase console and download the file again; until then this build has no push alerts.`);
  } catch {
    console.warn(`[app.config] ${file} isn't valid JSON; this build has no push alerts.`);
  }
  return null;
}
const googleServicesFile = googleServicesFor(androidPackage);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `Kangaroo Gym Pilot${nameSuffix}`,
  // Your Expo account or organisation (set EXPO_OWNER), used by EAS.
  ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
  slug: "fitcrm",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "fitcrm",
  userInterfaceStyle: "automatic",
  ios: {
    icon: "./assets/expo.icon",
    bundleIdentifier: `com.kangagympilot.member${suffix}`,
    supportsTablet: true,
    infoPlist: {
      // Production builds talk HTTPS only (no ATS exceptions are added for any environment).
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: androidPackage,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      backgroundColor: "#FFF4ED",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    // Don't back up app data to the cloud: tokens in SecureStore can't be decrypted after restore.
    allowBackup: false,
    predictiveBackGestureEnabled: false,
  },
  web: { output: "static", favicon: "./assets/images/favicon.png" },
  plugins: [
    "expo-router",
    ["expo-splash-screen", { backgroundColor: "#ea580c", image: "./assets/images/splash-icon.png", imageWidth: 76 }],
    ["expo-secure-store", { configureAndroidBackup: true, faceIDPermission: "Allow $(PRODUCT_NAME) to use Face ID to unlock the app." }],
    // Camera for scanning members' QR codes at the front desk (no microphone, no recording).
    ["expo-camera", { cameraPermission: "Allow $(PRODUCT_NAME) to use the camera to scan members' check-in QR codes.", microphonePermission: false, recordAudioAndroid: false }],
    // Progress photos: from the camera or the photo library (no microphone; videos aren't allowed).
    ["expo-image-picker", { photosPermission: "Allow $(PRODUCT_NAME) to choose progress photos from your library.", cameraPermission: "Allow $(PRODUCT_NAME) to take progress photos.", microphonePermission: false }],
    // Push alerts: Android needs a notification channel and a small monochrome icon.
    ["expo-notifications", { icon: "./assets/images/android-icon-monochrome.png", color: "#ea580c", defaultChannel: "default" }],
    ["expo-local-authentication", { faceIDPermission: "Allow $(PRODUCT_NAME) to use Face ID to unlock the app." }],
    [
      "expo-build-properties",
      {
        // Plain HTTP only in development builds, so a phone can reach your PC's LAN IP.
        android: { usesCleartextTraffic: APP_ENV === "development" },
      },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    appEnv: APP_ENV,
    // How Android devices get push alerts: "fcm" (Firebase, when this build includes
    // google-services.json) or "expo" (Expo's push service, needs the EAS project id below).
    pushTransport: googleServicesFile ? "fcm" : "expo",
    // The EAS project (from `eas init`): links cloud builds to it and lets Expo issue push tokens.
    // It's a public identifier, not a secret. EAS_PROJECT_ID overrides it (e.g. for a fork).
    eas: { projectId: process.env.EAS_PROJECT_ID ?? "7d0a6003-00a5-403c-9bee-b5655f234f02" },
  },
});
