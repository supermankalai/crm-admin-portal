import * as SecureStore from "expo-secure-store";

/**
 * Everything secret lives in SecureStore (Keychain / Keystore), never in AsyncStorage:
 * the refresh token and the session id. Values stay small (iOS may refuse > ~2 KB).
 * The access token is kept in memory only.
 */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const KEYS = {
  refreshToken: "fitcrm.refresh",
  sessionId: "fitcrm.session",
  gymSlug: "fitcrm.gym",
  prefs: "fitcrm.prefs",
} as const;

export type Prefs = { biometrics: boolean; lockAfterMinutes: number };
export const DEFAULT_PREFS: Prefs = { biometrics: false, lockAfterMinutes: 5 };

export const secure = {
  getRefreshToken: () => SecureStore.getItemAsync(KEYS.refreshToken, OPTIONS),
  setRefreshToken: (value: string) => SecureStore.setItemAsync(KEYS.refreshToken, value, OPTIONS),
  getSessionId: () => SecureStore.getItemAsync(KEYS.sessionId, OPTIONS),
  setSessionId: (value: string) => SecureStore.setItemAsync(KEYS.sessionId, value, OPTIONS),
  getGymSlug: () => SecureStore.getItemAsync(KEYS.gymSlug, OPTIONS),
  setGymSlug: async (value: string | null) => (value ? SecureStore.setItemAsync(KEYS.gymSlug, value, OPTIONS) : SecureStore.deleteItemAsync(KEYS.gymSlug, OPTIONS)),

  async getPrefs(): Promise<Prefs> {
    try {
      const raw = await SecureStore.getItemAsync(KEYS.prefs, OPTIONS);
      return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
    } catch {
      return DEFAULT_PREFS;
    }
  },
  setPrefs: (prefs: Prefs) => SecureStore.setItemAsync(KEYS.prefs, JSON.stringify(prefs), OPTIONS),

  /** Sign-out: remove every credential (prefs are kept — they aren't secret). */
  async clearCredentials() {
    await Promise.all([KEYS.refreshToken, KEYS.sessionId, KEYS.gymSlug].map((k) => SecureStore.deleteItemAsync(k, OPTIONS)));
  },
};
