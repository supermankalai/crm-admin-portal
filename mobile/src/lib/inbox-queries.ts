import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RequestOf, ResponseOf } from "@fitcrm/shared/api/contract";
import { useSession } from "@/hooks/use-session";
import type { GymRole } from "@fitcrm/shared/api/schemas";
import { routesFor, type TabKey } from "@/nav/tabs";
import { gymKey } from "./query";
import { api } from "./session";

/**
 * Inbox, push preferences, announcements and the member's profile. The inbox and profile hold
 * personal details, so they're `sensitive` (memory only); announcements are gym-public and cached.
 */

export type InboxItem = ResponseOf<"notifications">["items"][number];
export type Preferences = ResponseOf<"notificationPreferences">;
export type MemberProfile = ResponseOf<"memberProfile">;

function useGymSlug() {
  return useSession().gym?.slug ?? "none";
}

const PAGE = 20;

export function useInbox() {
  const slug = useGymSlug();
  return useInfiniteQuery({
    queryKey: gymKey(slug, "inbox"),
    queryFn: ({ pageParam }) => api.call("notifications", { query: { limit: PAGE, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    meta: { sensitive: true },
  });
}

/** Unread count for the tab badge: one tiny request a minute while the app is open. */
export function useUnreadCount() {
  const slug = useGymSlug();
  const q = useQuery({
    queryKey: gymKey(slug, "inbox-unread"),
    queryFn: () => api.call("notifications", { query: { limit: 1 } }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    meta: { sensitive: true },
  });
  return q.data?.unread ?? 0;
}

function useRefreshInbox() {
  const slug = useGymSlug();
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: gymKey(slug, "inbox") }), qc.invalidateQueries({ queryKey: gymKey(slug, "inbox-unread") })]);
}

export function useReadNotification() {
  const refresh = useRefreshInbox();
  return useMutation({ mutationFn: (notificationId: string) => api.call("readNotification", { params: { notificationId } }), onSettled: refresh });
}

export function useReadAll() {
  const refresh = useRefreshInbox();
  return useMutation({ mutationFn: () => api.call("readAllNotifications"), onSettled: refresh });
}

export function usePreferences() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "push-prefs"), queryFn: () => api.call("notificationPreferences") });
}

export function useUpdatePreferences() {
  const slug = useGymSlug();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RequestOf<"updateNotificationPreferences">["body"]) => api.call("updateNotificationPreferences", { body }),
    onSuccess: (data) => qc.setQueryData(gymKey(slug, "push-prefs"), data),
  });
}

export function useAnnouncements() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "announcements"), queryFn: () => api.call("announcements") });
}

export function useMemberProfile() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "profile"), queryFn: () => api.call("memberProfile"), meta: { sensitive: true } });
}

export function useUpdateProfile() {
  const slug = useGymSlug();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RequestOf<"memberUpdateProfile">["body"]) => api.call("memberUpdateProfile", { body }),
    onSuccess: (data) => qc.setQueryData(gymKey(slug, "profile"), data),
  });
}

export function useRequestDeletion() {
  const slug = useGymSlug();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.call("memberRequestDeletion", { body: { reason, confirm: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gymKey(slug, "profile") }),
  });
}

/** Where tapping a notification goes, and which tab a role needs to have that screen. */
const TARGETS = {
  classes: { route: "/classes", tab: "classes" },
  membership: { route: "/card/membership", tab: "card" },
  payments: { route: "/more/payments", tab: "more" },
  announcements: { route: "/more/announcements", tab: "more" },
  alerts: { route: "/alerts", tab: "alerts" },
  members: { route: "/members", tab: "members" },
} as const satisfies Record<NonNullable<InboxItem["target"]>, { route: string; tab: TabKey }>;

export function targetRoute(target: InboxItem["target"], role: GymRole | undefined) {
  const t = target ? TARGETS[target] : null;
  return t && routesFor(role).includes(t.tab) ? t.route : null;
}
