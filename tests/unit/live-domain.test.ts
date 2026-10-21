import { describe, expect, it } from "vitest";
import {
  classDisplayName,
  hasVideoRoom,
  joinTiming,
  LIVE_TOKEN_MAX_SECONDS,
  liveGrants,
  liveIdentity,
  liveMaxParticipants,
  liveRoomName,
  parseLiveIdentity,
  parseLiveRoomName,
  tokenTtlSeconds,
} from "@/domain/live";

const at = (iso: string) => new Date(iso);
const starts = at("2026-10-21T10:00:00Z");
const ends = at("2026-10-21T11:00:00Z");

describe("the join window", () => {
  it("opens 10 minutes before the start and closes 15 minutes after the end", () => {
    expect(joinTiming(starts, ends, at("2026-10-21T09:49:59Z"))).toBe("too_early");
    expect(joinTiming(starts, ends, at("2026-10-21T09:50:00Z"))).toBe("open");
    expect(joinTiming(starts, ends, at("2026-10-21T11:14:59Z"))).toBe("open");
    expect(joinTiming(starts, ends, at("2026-10-21T11:15:00Z"))).toBe("ended");
  });

  it("gives tokens that last until the window closes, capped and never under a minute", () => {
    expect(tokenTtlSeconds(ends, at("2026-10-21T10:00:00Z"))).toBe(75 * 60);
    expect(tokenTtlSeconds(ends, at("2026-10-21T11:14:30Z"))).toBe(60);
    expect(tokenTtlSeconds(at("2026-10-21T20:00:00Z"), at("2026-10-21T10:00:00Z"))).toBe(LIVE_TOKEN_MAX_SECONDS);
  });
});

describe("room names and identities", () => {
  it("round-trip, and name the gym so rooms of different gyms never meet", () => {
    const name = liveRoomName("gym1abc", "class", "sess9xyz");
    expect(name).toBe("g_gym1abc__class_sess9xyz");
    expect(parseLiveRoomName(name)).toEqual({ gymId: "gym1abc", kind: "class", sessionId: "sess9xyz" });
    expect(parseLiveRoomName(liveRoomName("g", "pt", "s"))).toEqual({ gymId: "g", kind: "pt", sessionId: "s" });
  });

  it("ignore rooms this app didn't name (other apps can share the server)", () => {
    for (const other of ["standup", "live-check-1234", "g_a__video_b", "g_a_b__class_c", "g_a__class_b__x", "g___class_b", ""]) {
      expect(parseLiveRoomName(other)).toBeNull();
    }
  });

  it("use member and staff ids, never user ids or emails", () => {
    expect(liveIdentity({ memberId: "m1" })).toBe("m_m1");
    expect(liveIdentity({ staffId: "s1" })).toBe("s_s1");
    expect(parseLiveIdentity("m_m1")).toEqual({ memberId: "m1" });
    expect(parseLiveIdentity("s_s1")).toEqual({ staffId: "s1" });
    for (const bad of ["u_1", "m_", "alice@example.com", "m_a_b", "s_x y"]) expect(parseLiveIdentity(bad)).toBeNull();
  });
});

describe("rights in the room", () => {
  it("lets the class host moderate and share a screen; members only use camera and mic", () => {
    expect(liveGrants("host")).toMatchObject({ roomAdmin: true, sources: ["camera", "microphone", "screen_share"] });
    expect(liveGrants("coach")).toMatchObject({ roomAdmin: false, sources: ["camera", "microphone", "screen_share"] });
    expect(liveGrants("member")).toMatchObject({ roomAdmin: false, sources: ["camera", "microphone"] });
  });

  it("sizes rooms to the class, and PT calls to the two people", () => {
    expect(liveMaxParticipants("class", 20)).toBe(22);
    expect(liveMaxParticipants("pt", 1)).toBe(3);
  });

  it("shows members in classes by first name and initial", () => {
    expect(classDisplayName("Alice", "anand")).toBe("Alice A.");
    expect(classDisplayName(" Bo ", "")).toBe("Bo");
  });

  it("has a video room only for online and hybrid sessions", () => {
    expect(hasVideoRoom("IN_PERSON")).toBe(false);
    expect(hasVideoRoom("ONLINE")).toBe(true);
    expect(hasVideoRoom("HYBRID")).toBe(true);
  });
});
