import Constants from "expo-constants";

export type AppEnv = "development" | "staging" | "production";

export const appEnv: AppEnv = ((Constants.expoConfig?.extra as { appEnv?: AppEnv } | undefined)?.appEnv ?? "development") as AppEnv;

/**
 * Validate the API base URL. Only development builds may use plain HTTP (a LAN IP or the
 * emulator); staging and production must use HTTPS, or the app refuses to start.
 */
export function resolveApiUrl(raw: string | undefined, env: AppEnv): { ok: true; url: string } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: "EXPO_PUBLIC_API_URL is not set. See mobile/README.md." };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "EXPO_PUBLIC_API_URL is not a valid URL." };
  }
  if (env !== "development" && parsed.protocol !== "https:") return { ok: false, error: "This build must talk to the server over HTTPS." };
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, error: "EXPO_PUBLIC_API_URL must be http(s)." };
  return { ok: true, url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}` };
}

// Inlined at build time by Expo (EXPO_PUBLIC_* only) — never put secrets here.
export const apiConfig = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, appEnv);
export const apiBaseUrl = apiConfig.ok ? apiConfig.url : "";

/** Turn a server-relative path (e.g. a signed logo URL) into an absolute URL. */
export function absoluteUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${apiBaseUrl}${path}`;
}
