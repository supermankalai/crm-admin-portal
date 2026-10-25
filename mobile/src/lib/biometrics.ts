import * as LocalAuthentication from "expo-local-authentication";

/** Face ID / fingerprint unlock. Biometric data never leaves the device; the server never sees it. */

export type BiometricSupport = { available: boolean; label: string };

export async function biometricSupport(): Promise<BiometricSupport> {
  try {
    const [hardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const label = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
      ? "Face ID"
      : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
        ? "Fingerprint"
        : "Biometrics";
    return { available: hardware && enrolled, label };
  } catch {
    return { available: false, label: "Biometrics" };
  }
}

export async function authenticate(promptMessage: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: "Cancel", disableDeviceFallback: false });
    return result.success;
  } catch {
    return false;
  }
}
