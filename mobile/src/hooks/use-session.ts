import { useSyncExternalStore } from "react";
import { session, type SessionState } from "@/lib/session";

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState, session.getState);
}
