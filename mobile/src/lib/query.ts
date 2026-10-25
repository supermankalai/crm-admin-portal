import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { focusManager, onlineManager, QueryClient, type Query } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";
import { ApiError } from "@fitcrm/shared/api/client";

/**
 * Server data cache. Recent results are persisted so the app opens instantly and shows the last
 * known data offline — except queries marked `meta: { sensitive: true }` (measurements, notes,
 * photos), which stay in memory only. Everything is wiped on sign-out, and a gym's data is
 * removed when leaving that gym. Tokens are never part of the cache.
 */

export const CACHE_KEY = "fitcrm.query-cache";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 60 * 60_000,
      networkMode: "offlineFirst",
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
    mutations: {
      // Actions that need the server (check-in, booking, payment) are disabled in the UI while
      // offline, with a message — never silently queued.
      networkMode: "always",
      retry: false,
    },
  },
});

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: CACHE_KEY, throttleTime: 2000 });

export function shouldPersist(query: Pick<Query, "state" | "meta">): boolean {
  return query.state.status === "success" && query.meta?.sensitive !== true;
}

/** Query keys for a gym's data all start with ["gym", slug] so a gym's cache can be dropped. */
export function gymKey(slug: string, ...parts: (string | number | Record<string, unknown>)[]) {
  return ["gym", slug, ...parts] as const;
}

export function forgetGym(slug: string) {
  queryClient.removeQueries({ queryKey: ["gym", slug] });
}

export async function clearAllCaches() {
  queryClient.clear();
  await persister.removeClient();
  await AsyncStorage.removeItem(CACHE_KEY);
}

/** Wire TanStack Query to the device: network state and app focus. Call once at startup. */
export function connectQueryToDevice() {
  onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false)));
  const sub = AppState.addEventListener("change", (status) => {
    if (Platform.OS !== "web") focusManager.setFocused(status === "active");
  });
  return () => sub.remove();
}
