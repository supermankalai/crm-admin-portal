import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RequestOf, ResponseOf } from "@fitcrm/shared/api/contract";
import { useSession } from "@/hooks/use-session";
import { gymKey } from "./query";
import { api } from "./session";

/**
 * Workouts, progress and trainer data. Measurements, photos, notes and client details are
 * `sensitive`: memory only, never written to the device's cache. Workout plans and schedules are
 * cached so a member can follow their plan offline.
 */

export type MemberWorkouts = ResponseOf<"memberWorkouts">;
export type MemberProgress = ResponseOf<"memberProgress">;
export type ScheduleItem = ResponseOf<"trainerSchedule">["items"][number];
export type TrainerClient = ResponseOf<"trainerClient">;
export type PlanDetail = ResponseOf<"trainerPlan">;
export type TrainingSessionItem = ResponseOf<"memberTrainingSessions">["sessions"][number];

function useGymSlug() {
  return useSession().gym?.slug ?? "none";
}

function useInvalidate() {
  const slug = useGymSlug();
  const qc = useQueryClient();
  return (...parts: string[]) => qc.invalidateQueries({ queryKey: gymKey(slug, ...parts) });
}

// ─────────────────────────────── Member ───────────────────────────────

export function useMemberWorkouts() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "workouts"), queryFn: () => api.call("memberWorkouts") });
}

export function useCompleteWorkout() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ dayId, note }: { dayId: string; note: string }) => api.call("memberCompleteWorkout", { params: { dayId }, body: { note } }),
    onSettled: () => invalidate("workouts"),
  });
}

export function useMemberSessions() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "pt-sessions"), queryFn: () => api.call("memberTrainingSessions") });
}

export function useMemberProgress() {
  const slug = useGymSlug();
  // Photo links expire after 5 minutes: refetch before then while the screen is open.
  return useQuery({ queryKey: gymKey(slug, "progress"), queryFn: () => api.call("memberProgress"), staleTime: 60_000, refetchInterval: 4 * 60_000, meta: { sensitive: true } });
}

export function useSaveProgress() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: RequestOf<"memberSaveProgress">["body"]) => api.call("memberSaveProgress", { body }), onSuccess: () => invalidate("progress") });
}

export function useDeleteProgress() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (entryId: string) => api.call("memberDeleteProgress", { params: { entryId } }), onSuccess: () => invalidate("progress") });
}

export function useUploadPhoto() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ uri, takenOn }: { uri: string; takenOn: string }) => api.call("memberUploadPhoto", { body: { takenOn }, file: { uri, name: "progress.jpg", type: "image/jpeg" } }),
    onSuccess: () => invalidate("progress"),
  });
}

export function useDeletePhoto() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (photoId: string) => api.call("memberDeletePhoto", { params: { photoId } }), onSuccess: () => invalidate("progress") });
}

// ─────────────────────────────── Trainer ───────────────────────────────

export function useTrainerSchedule() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "trainer", "schedule"), queryFn: () => api.call("trainerSchedule", { query: {} }) });
}

export function useTrainerClients() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "trainer", "clients"), queryFn: () => api.call("trainerClients"), meta: { sensitive: true } });
}

export function useTrainerClient(memberId: string) {
  const slug = useGymSlug();
  return useQuery({
    queryKey: gymKey(slug, "trainer", "client", memberId),
    queryFn: () => api.call("trainerClient", { params: { memberId } }),
    staleTime: 60_000,
    refetchInterval: 4 * 60_000,
    meta: { sensitive: true },
  });
}

export function useAddNote(memberId: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: string) => api.call("trainerAddNote", { params: { memberId }, body: { body } }), onSuccess: () => invalidate("trainer", "client", memberId) });
}

export function useTrainerPlans() {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "trainer", "plans"), queryFn: () => api.call("trainerPlans") });
}

export function useTrainerPlan(planId: string | undefined) {
  const slug = useGymSlug();
  return useQuery({ queryKey: gymKey(slug, "trainer", "plan", planId ?? "new"), queryFn: () => api.call("trainerPlan", { params: { planId: planId! } }), enabled: !!planId });
}

export function useSavePlan() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { planId?: string; body: RequestOf<"trainerUpdatePlan">["body"]; memberId: string | null }) =>
      v.planId ? api.call("trainerUpdatePlan", { params: { planId: v.planId }, body: v.body }) : api.call("trainerCreatePlan", { body: { ...v.body, memberId: v.memberId } }),
    onSuccess: () => invalidate("trainer"),
  });
}

export function useAssignPlan() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: ({ planId, memberId }: { planId: string; memberId: string }) => api.call("trainerAssignPlan", { params: { planId }, body: { memberId } }), onSuccess: () => invalidate("trainer") });
}

export function useCreateSession() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: RequestOf<"trainerCreateSession">["body"]) => api.call("trainerCreateSession", { body }), onSuccess: () => invalidate("trainer") });
}

export function useUpdateSession() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "COMPLETED" | "CANCELLED" | "NO_SHOW" }) => api.call("trainerUpdateSession", { params: { trainingSessionId: id }, body: { status } }),
    onSuccess: () => invalidate("trainer"),
  });
}

export function useMarkAttendance(sessionId: string) {
  const slug = useGymSlug();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, attended }: { bookingId: string; attended: boolean }) => api.call("trainerAttendance", { params: { bookingId }, body: { attended } }),
    onSettled: () => qc.invalidateQueries({ queryKey: gymKey(slug, "staff", "class", sessionId) }),
  });
}
