import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError, createApiClient, NetworkError } from "@fitcrm/shared/api/client";
import type { ResponseOf } from "@fitcrm/shared/api/contract";
import { apiBaseUrl } from "./config";
import { log } from "./log";
import { secure } from "./secure";

/**
 * The signed-in session, as a tiny store (no framework). Rules:
 *   - access token: memory only; refresh token: SecureStore only
 *   - one refresh at a time (concurrent 401s share it — a second parallel refresh would look like
 *     token reuse and the server would revoke the device)
 *   - sign-out / revocation wipes tokens and every cache; leaving a gym wipes that gym's cache
 *   - the last known user, gyms and gym are kept (non-secret) so the app can open offline
 */

export type GymSummary = ResponseOf<"login">["gyms"][number];
export type CurrentGym = ResponseOf<"gym">;
export type SignedOutReason = "logout" | "revoked" | "expired" | "password_changed" | null;

export type SessionState = {
  phase: "booting" | "signedOut" | "signedIn";
  user: { id: string; name: string } | null;
  gyms: GymSummary[];
  gym: CurrentGym | null;
  /** Biometric lock is up: nothing behind it is shown. */
  locked: boolean;
  /** Last refresh couldn't reach the server; showing cached data. */
  offline: boolean;
  signedOutReason: SignedOutReason;
  /** Why the app is back on the gym picker (e.g. removed from that gym). */
  gymNotice: string | null;
};

const META_KEY = "fitcrm.session-meta";
type Meta = { user: SessionState["user"]; gyms: GymSummary[]; gym: CurrentGym | null };

let state: SessionState = { phase: "booting", user: null, gyms: [], gym: null, locked: false, offline: false, signedOutReason: null, gymNotice: null };
let accessToken: string | null = null;
const listeners = new Set<() => void>();
const resetHooks = new Set<() => Promise<void> | void>();
const leaveGymHooks = new Set<(slug: string) => void>();

function setState(patch: Partial<SessionState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const session = {
  getState: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Run on sign-out/revocation (e.g. clear the query cache). */
  onReset(hook: () => Promise<void> | void) {
    resetHooks.add(hook);
    return () => resetHooks.delete(hook);
  },
  /** Run when leaving a gym (switch or sign-out), with that gym's slug. */
  onLeaveGym(hook: (slug: string) => void) {
    leaveGymHooks.add(hook);
    return () => leaveGymHooks.delete(hook);
  },
};

/** The API client used everywhere. 401s trigger one shared refresh and a single retry. */
export const api = createApiClient({
  baseUrl: apiBaseUrl,
  getAccessToken: () => accessToken,
  refresh: () => refreshAccess(),
});

async function saveMeta() {
  const meta: Meta = { user: state.user, gyms: state.gyms, gym: state.gym };
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
}

// ─────────────────────────────── refresh ───────────────────────────────

let inflight: Promise<boolean> | null = null;

/** Single-flight refresh. Resolves true when a fresh access token is in memory. */
export function refreshAccess(): Promise<boolean> {
  inflight ??= doRefresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = await secure.getRefreshToken();
  if (!refreshToken) {
    await signOutLocal("expired");
    return false;
  }
  try {
    const gymSlug = state.gym?.slug ?? (await secure.getGymSlug()) ?? undefined;
    const r = await api.call("refresh", { body: { refreshToken, gymSlug } });
    await secure.setRefreshToken(r.refreshToken);
    accessToken = r.accessToken;
    if (r.gymError) {
      // The gym can't be used any more (removed, plan changed): back to the picker, keep the session.
      await leaveGym(r.gymError.message);
      setState({ offline: false });
    } else {
      setState({ gym: r.gym ?? state.gym, offline: false });
    }
    await saveMeta();
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      log.warn("refresh rejected", { code: error.code });
      await signOutLocal(error.code === "session_revoked" ? "revoked" : "expired");
      return false;
    }
    if (error instanceof NetworkError) {
      setState({ offline: true });
      return false;
    }
    throw error;
  }
}

// ─────────────────────────────── lifecycle ───────────────────────────────

/** App start: restore the last known session (offline-capable), then refresh unless locked. */
export async function bootstrap(opts: { lockOnStart: boolean }) {
  const refreshToken = await secure.getRefreshToken();
  if (!refreshToken) {
    setState({ phase: "signedOut" });
    return;
  }
  let meta: Meta | null = null;
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    meta = raw ? (JSON.parse(raw) as Meta) : null;
  } catch {
    meta = null;
  }
  setState({ phase: "signedIn", user: meta?.user ?? null, gyms: meta?.gyms ?? [], gym: meta?.gym ?? null, locked: opts.lockOnStart });
  if (!opts.lockOnStart) await refreshAccess().catch(() => false);
}

/** After any successful sign-in response (password, code, invite). */
export async function signIn(r: ResponseOf<"login">) {
  await secure.setRefreshToken(r.refreshToken);
  await secure.setSessionId(r.sessionId);
  accessToken = r.accessToken;
  setState({ phase: "signedIn", user: r.user, gyms: r.gyms, gym: null, locked: false, offline: false, signedOutReason: null, gymNotice: null });
  await saveMeta();
  const usable = r.gyms.filter((g) => g.appAccess.allowed);
  if (r.gyms.length === 1 && usable.length === 1) await selectGym(usable[0].slug);
}

export async function selectGym(slug: string) {
  const previous = state.gym?.slug;
  const r = await api.call("selectGym", { body: { gymSlug: slug } });
  if (previous && previous !== slug) leaveGymHooks.forEach((h) => h(previous));
  accessToken = r.accessToken;
  await secure.setGymSlug(slug);
  setState({ gym: r.gym, gymNotice: null });
  await saveMeta();
}

/** Back to the gym picker (switching gyms). The previous gym's cached data is removed. */
export async function leaveGym(notice: string | null = null) {
  const previous = state.gym?.slug;
  if (previous) leaveGymHooks.forEach((h) => h(previous));
  await secure.setGymSlug(null);
  setState({ gym: null, gymNotice: notice });
  await saveMeta();
}

export async function updateGyms(gyms: GymSummary[]) {
  setState({ gyms });
  await saveMeta();
}

/** Sign out: tell the server (best effort, it may be offline), then wipe everything local. */
export async function signOut() {
  if (accessToken) await api.call("logout").catch(() => undefined);
  await signOutLocal("logout");
}

/** Wipe tokens, caches and session meta. Used for sign-out, revocation and expiry. */
export async function signOutLocal(reason: SignedOutReason) {
  const previous = state.gym?.slug;
  accessToken = null;
  await secure.clearCredentials();
  await AsyncStorage.removeItem(META_KEY);
  if (previous) leaveGymHooks.forEach((h) => h(previous));
  for (const hook of resetHooks) await hook();
  setState({ phase: "signedOut", user: null, gyms: [], gym: null, locked: false, offline: false, signedOutReason: reason, gymNotice: null });
}

export function lock() {
  if (state.phase === "signedIn") setState({ locked: true });
}

export async function unlocked() {
  setState({ locked: false });
  await refreshAccess().catch(() => false);
}

/** For tests only. */
export function __resetSessionForTests() {
  state = { phase: "booting", user: null, gyms: [], gym: null, locked: false, offline: false, signedOutReason: null, gymNotice: null };
  accessToken = null;
  inflight = null;
  listeners.clear();
  resetHooks.clear();
  leaveGymHooks.clear();
}
