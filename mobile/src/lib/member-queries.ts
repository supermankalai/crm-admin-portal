import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { gymKey } from "./query";
import { api } from "./session";

/**
 * Member app data. Keys start with ["gym", slug] so leaving a gym drops its data. The card
 * (live QR code) and money/attendance history are `sensitive`: kept in memory only, never written
 * to the device's cache. The timetable and membership are cached for offline viewing.
 */

function useGymSlug() {
  return useSession().gym?.slug ?? "none";
}

export function useMemberCard() {
  const slug = useGymSlug();
  return useQuery({
    queryKey: gymKey(slug, "card"),
    queryFn: () => api.call("memberCard"),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime: 60_000,
    meta: { sensitive: true },
  });
}

export function useMembership() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "membership"), queryFn: () => api.call("memberMembership") });
}

export function useMemberClasses() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "classes"), queryFn: () => api.call("memberClasses", { query: {} }) });
}

export function useBookClass() {
  const slug = useGymSlug();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.call("memberBook", { params: { sessionId } }),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: gymKey(slug, "classes") }), qc.invalidateQueries({ queryKey: gymKey(slug, "membership") })]),
  });
}

export function useCancelBooking() {
  const slug = useGymSlug();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => api.call("memberCancelBooking", { params: { bookingId } }),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: gymKey(slug, "classes") }), qc.invalidateQueries({ queryKey: gymKey(slug, "membership") })]),
  });
}

const PAGE = 20;

export function useAttendance() {
  const slug = useGymSlug();
  return useInfiniteQuery({
    queryKey: gymKey(slug, "attendance"),
    queryFn: ({ pageParam }) => api.call("memberAttendance", { query: { limit: PAGE, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    meta: { sensitive: true },
  });
}

export function usePayments() {
  const slug = useGymSlug();
  return useInfiniteQuery({
    queryKey: gymKey(slug, "payments"),
    queryFn: ({ pageParam }) => api.call("memberPayments", { query: { limit: PAGE, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    meta: { sensitive: true },
  });
}

export function useInvoices() {
  const slug = useGymSlug();
  return useInfiniteQuery({
    queryKey: gymKey(slug, "invoices"),
    queryFn: ({ pageParam }) => api.call("memberInvoices", { query: { limit: PAGE, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    meta: { sensitive: true },
  });
}

export function useInvoice(invoiceId: string) {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "invoice", invoiceId), queryFn: () => api.call("memberInvoice", { params: { invoiceId } }), meta: { sensitive: true } });
}
