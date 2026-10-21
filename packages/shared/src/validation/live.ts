import { z } from "zod";

const id = z.string().trim().min(1).max(64);

/** Web portal: get a token to join a class or PT call (the session's trainer only). */
export const liveJoinSchema = z.object({ kind: z.enum(["class", "pt"]), sessionId: id });
/** Web portal: the class host mutes or removes someone in the call. */
export const liveModerateSchema = z.object({ sessionId: id, identity: z.string().trim().min(3).max(80), action: z.enum(["mute", "remove"]) });
