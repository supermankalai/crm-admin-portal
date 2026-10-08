import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RequestOf, ResponseOf } from "@fitcrm/shared/api/contract";
import { useSession } from "@/hooks/use-session";
import { gymKey } from "./query";
import { api } from "./session";

/**
 * Staff app data (front desk, owner, manager). Anything with member names, contact details or
 * money is `sensitive`: memory only, never written to the device's cache. Class timetables and
 * check-in locations are cached for offline viewing.
 */

export type StaffMemberRow = ResponseOf<"staffMembers">["items"][number];
export type StaffMemberProfile = ResponseOf<"staffMember">;
export type StaffClass = ResponseOf<"staffClasses">["classes"][number];
export type CheckInCandidate = ResponseOf<"staffCheckInLookup">["candidates"][number];
export type CheckInResult = ResponseOf<"staffCheckIn">;
export type MemberStatus = StaffMemberRow["status"];

function useGymSlug() {
  return useSession().gym?.slug ?? "none";
}

export function useCheckInSetup() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "staff", "check-in"), queryFn: () => api.call("staffCheckInSetup") });
}

/** Lookups are one-off actions (a scan or a search), not cached data. */
export function useCheckInLookup() {
  return useMutation({ mutationFn: (query: string) => api.call("staffCheckInLookup", { body: { query } }) });
}

export function useCheckIn() {
  const slug = useGymSlug();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RequestOf<"staffCheckIn">["body"]) => api.call("staffCheckIn", { body }),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: gymKey(slug, "staff", "check-in") }), qc.invalidateQueries({ queryKey: gymKey(slug, "staff", "dashboard") })]),
  });
}

export function useStaffDashboard() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "staff", "dashboard"), queryFn: () => api.call("staffDashboard"), meta: { sensitive: true } });
}

export function useStaffAlerts() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "staff", "alerts"), queryFn: () => api.call("staffAlerts"), meta: { sensitive: true } });
}

export function useStaffMembers(filters: { q: string; status?: MemberStatus }) {
  const slug = useGymSlug();
  return useInfiniteQuery({
    queryKey: gymKey(slug, "staff", "members", filters),
    queryFn: ({ pageParam }) => api.call("staffMembers", { query: { q: filters.q || undefined, status: filters.status, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    meta: { sensitive: true },
  });
}

export function useStaffMember(memberId: string) {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "staff", "member", memberId), queryFn: () => api.call("staffMember", { params: { memberId } }), meta: { sensitive: true } });
}

/** After a sale, payment or new member: refresh the lists and figures that show it. */
function useAfterMoneyChange() {
  const slug = useGymSlug();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: gymKey(slug, "staff") });
}

export function useCreateMember() {
  const done = useAfterMoneyChange();
  return useMutation({ mutationFn: (body: RequestOf<"staffCreateMember">["body"]) => api.call("staffCreateMember", { body }), onSuccess: done });
}

export function useStaffPlans() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "staff", "plans"), queryFn: () => api.call("staffPlans") });
}

export function useSellMembership() {
  const done = useAfterMoneyChange();
  return useMutation({ mutationFn: (body: RequestOf<"staffSellMembership">["body"]) => api.call("staffSellMembership", { body }), onSuccess: done });
}

export function useRecordPayment() {
  const done = useAfterMoneyChange();
  return useMutation({ mutationFn: (body: RequestOf<"staffRecordPayment">["body"]) => api.call("staffRecordPayment", { body }), onSuccess: done });
}

export function useInviteToApp(memberId: string) {
  const done = useAfterMoneyChange();
  return useMutation({
    mutationFn: (channel: "EMAIL" | "SMS" | "CODE") => api.call("createMemberInvite", { params: { memberId }, body: { channel } }),
    onSuccess: done,
  });
}

export function useStaffClasses() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "staff", "classes"), queryFn: () => api.call("staffClasses", { query: {} }) });
}

export function useStaffClass(sessionId: string) {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "staff", "class", sessionId), queryFn: () => api.call("staffClass", { params: { sessionId } }), meta: { sensitive: true } });
}
