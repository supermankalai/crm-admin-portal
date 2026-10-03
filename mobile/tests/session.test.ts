import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { __resetSessionForTests, api, bootstrap, leaveGym, refreshAccess, selectGym, session, signIn, signOut } from "@/lib/session";

/**
 * Session rules: tokens only in SecureStore (refresh) and memory (access), one refresh at a time,
 * and everything wiped on sign-out or revocation.
 */

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const gymA = { slug: "gym-a", name: "Gym A", brandColor: "#ea580c", logoUrl: null, role: "MEMBER" as const, appAccess: { allowed: true, reason: null } };
const currentA = { slug: "gym-a", name: "Gym A", brandColor: "#ea580c", logoUrl: null, timezone: "Asia/Kolkata", currency: "INR", role: "MEMBER" as const, permissions: [], access: { writable: true, reason: null, isTrial: false, endsAt: null } };
const loginResponse = (gyms = [gymA]) => ({
  accessToken: "access-1",
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  refreshToken: "refresh-1".padEnd(43, "x"),
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  sessionId: "s1",
  user: { id: "u1", name: "Alex" },
  gyms,
});

/** The client only uses status, ok and json(); jest-expo's Response polyfill drops status. */
export function fakeResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

type Route = (url: string, init: RequestInit) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
let route: Route;
const calls: { url: string; init: RequestInit }[] = [];

beforeEach(async () => {
  __resetSessionForTests();
  store.clear();
  await AsyncStorage.clear();
  calls.length = 0;
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = await route(String(url), init ?? {});
    return fakeResponse(r.status, r.body);
  }) as unknown as typeof fetch;
});

const refreshOk = (n: number) => ({
  status: 200,
  body: { ...loginResponse(), accessToken: `access-${n}`, refreshToken: `refresh-${n}`.padEnd(43, "x"), gym: currentA, gymError: null },
});

describe("sign-in", () => {
  it("stores the refresh token only in SecureStore and opens the only gym", async () => {
    route = (url) => (url.endsWith("/auth/select-gym") ? { status: 200, body: { accessToken: "access-gym", accessTokenExpiresAt: new Date().toISOString(), gym: currentA } } : { status: 404, body: {} });
    await signIn(loginResponse());
    expect(store.get("fitcrm.refresh")).toBe("refresh-1".padEnd(43, "x"));
    expect(session.getState()).toMatchObject({ phase: "signedIn", gym: { slug: "gym-a" } });
    // Nothing secret in AsyncStorage.
    const keys = await AsyncStorage.getAllKeys();
    for (const k of keys) expect(await AsyncStorage.getItem(k)).not.toContain("refresh-1");
    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer access-1" });
  });

  it("shows the picker when there are several gyms", async () => {
    route = () => ({ status: 500, body: {} });
    await signIn(loginResponse([gymA, { ...gymA, slug: "gym-b", name: "Gym B" }]));
    expect(session.getState().gym).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("refresh", () => {
  it("runs once even when many requests need it at the same time", async () => {
    store.set("fitcrm.refresh", "refresh-0".padEnd(43, "x"));
    let resolve!: () => void;
    const gate = new Promise<void>((r) => (resolve = r));
    route = async (url) => {
      if (url.endsWith("/auth/refresh")) {
        await gate;
        return refreshOk(2);
      }
      return { status: 404, body: {} };
    };
    const results = Promise.all([refreshAccess(), refreshAccess(), refreshAccess()]);
    resolve();
    expect(await results).toEqual([true, true, true]);
    expect(calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
    expect(store.get("fitcrm.refresh")).toBe("refresh-2".padEnd(43, "x"));
  });

  it("an expired access token is refreshed once and the request retried", async () => {
    store.set("fitcrm.refresh", "refresh-0".padEnd(43, "x"));
    let meCalls = 0;
    route = (url, init) => {
      if (url.endsWith("/auth/refresh")) return refreshOk(3);
      if (url.endsWith("/me")) {
        meCalls++;
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === "Bearer access-3" ? { status: 200, body: { user: { id: "u1", name: "Alex", email: null, phone: null }, gyms: [] } } : { status: 401, body: { error: { code: "invalid_token", message: "x" } } };
      }
      return { status: 404, body: {} };
    };
    const me = await api.call("me");
    expect(me.user.name).toBe("Alex");
    expect(meCalls).toBe(2);
  });

  it("a revoked session signs out and wipes tokens and caches", async () => {
    route = (url) => (url.endsWith("/auth/select-gym") ? { status: 200, body: { accessToken: "a", accessTokenExpiresAt: new Date().toISOString(), gym: currentA } } : { status: 401, body: { error: { code: "session_revoked", message: "Signed out" } } });
    await signIn(loginResponse());
    const reset = jest.fn();
    const left = jest.fn();
    session.onReset(reset);
    session.onLeaveGym(left);
    expect(await refreshAccess()).toBe(false);
    expect(session.getState()).toMatchObject({ phase: "signedOut", signedOutReason: "revoked", gym: null, user: null });
    expect(store.size).toBe(0);
    expect(reset).toHaveBeenCalled();
    expect(left).toHaveBeenCalledWith("gym-a");
  });

  it("offline keeps the session and the last known data", async () => {
    store.set("fitcrm.refresh", "refresh-0".padEnd(43, "x"));
    await AsyncStorage.setItem("fitcrm.session-meta", JSON.stringify({ user: { id: "u1", name: "Alex" }, gyms: [gymA], gym: currentA }));
    global.fetch = jest.fn(async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    await bootstrap({ lockOnStart: false });
    expect(session.getState()).toMatchObject({ phase: "signedIn", offline: true, gym: { slug: "gym-a" } });
    expect(store.get("fitcrm.refresh")).toBeTruthy();
  });

  it("losing access to the gym returns to the picker but keeps the session", async () => {
    store.set("fitcrm.refresh", "refresh-0".padEnd(43, "x"));
    route = () => ({ status: 200, body: { ...refreshOk(4).body, gym: null, gymError: { code: "forbidden", message: "You no longer have access to this gym." } } });
    expect(await refreshAccess()).toBe(true);
    expect(session.getState()).toMatchObject({ gym: null, gymNotice: "You no longer have access to this gym." });
    expect(store.get("fitcrm.refresh")).toBe("refresh-4".padEnd(43, "x"));
  });

  it("biometric lock on start defers the refresh until unlocked", async () => {
    store.set("fitcrm.refresh", "refresh-0".padEnd(43, "x"));
    route = () => refreshOk(5);
    await bootstrap({ lockOnStart: true });
    expect(session.getState().locked).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("gyms and sign-out", () => {
  it("switching gyms drops the previous gym's cached data", async () => {
    route = (url, init) => {
      const slug = JSON.parse(String(init.body ?? "{}")).gymSlug as string;
      return url.endsWith("/auth/select-gym") ? { status: 200, body: { accessToken: `a-${slug}`, accessTokenExpiresAt: new Date().toISOString(), gym: { ...currentA, slug, name: slug } } } : { status: 404, body: {} };
    };
    await signIn(loginResponse([gymA, { ...gymA, slug: "gym-b", name: "Gym B" }]));
    const left = jest.fn();
    session.onLeaveGym(left);
    await selectGym("gym-a");
    await selectGym("gym-b");
    expect(left).toHaveBeenCalledWith("gym-a");
    await leaveGym();
    expect(left).toHaveBeenLastCalledWith("gym-b");
    expect(session.getState().gym).toBeNull();
  });

  it("sign-out tells the server, then wipes everything even if the server is unreachable", async () => {
    route = (url) => (url.endsWith("/auth/select-gym") ? { status: 200, body: { accessToken: "a", accessTokenExpiresAt: new Date().toISOString(), gym: currentA } } : { status: 200, body: { ok: true } });
    await signIn(loginResponse());
    await signOut();
    expect(calls.some((c) => c.url.endsWith("/auth/logout"))).toBe(true);
    expect(store.size).toBe(0);
    expect(await AsyncStorage.getItem("fitcrm.session-meta")).toBeNull();

    route = (url) => (url.endsWith("/auth/select-gym") ? { status: 200, body: { accessToken: "a", accessTokenExpiresAt: new Date().toISOString(), gym: currentA } } : { status: 200, body: { ok: true } });
    await signIn(loginResponse());
    global.fetch = jest.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    await signOut();
    expect(session.getState().phase).toBe("signedOut");
    expect(store.size).toBe(0);
  });
});
