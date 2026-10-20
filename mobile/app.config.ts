import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * One config, three environments (APP_ENV = development | staging | production, set per EAS
 * build profile or in your shell). Only public values go in here: the API URL and identifiers.
 * There are no secrets in the app bundle.
 */
const APP_ENV = (process.env.APP_ENV ?? "development") as "development" | "staging" | "production";
const suffix = APP_ENV === "production" ? "" : `.${APP_ENV === "staging" ? "staging" : "dev"}`;
const nameSuffix = APP_ENV === "production" ? "" : APP_ENV === "staging" ? " (Staging)" : " (Dev)";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `FitCRM${nameSuffix}`,
  slug: "fitcrm",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "fitcrm",
  userInterfaceStyle: "automatic",
  ios: {
    icon: "./assets/expo.icon",
    bundleIdentifier: `com.fitcrm.app${suffix}`,
    supportsTablet: true,
    infoPlist: {
      // Production builds talk HTTPS only (no ATS exceptions are added for any environment).
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: `com.fitcrm.app${suffix}`,
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
    // Expo needs the EAS project id to issue push tokens. Set EAS_PROJECT_ID (from `eas init`,
    // Phase 7); without it the app works normally, just without push alerts.
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
});
