import { describe, expect, it } from "vitest";
import { preferenceFor, pushText, type NotificationKind } from "@/domain/notifications";

describe("push notification text", () => {
  it("is generic: gym name as title, nothing personal in the body", () => {
    const kinds: NotificationKind[] = ["CLASS_REMINDER", "WAITLIST_PROMOTED", "MEMBERSHIP_EXPIRING", "PAYMENT_DUE", "MEMBERSHIP_EXPIRING", "PAYMENT_OVERDUE", "CLASS_FULL", "DELETION_REQUEST"];
    for (const kind of kinds) {
      for (const who of ["member", "staff"] as const) {
        const t = pushText(kind, who, "Iron Temple");
        expect(t.title).toBe("Iron Temple");
        expect(t.body).not.toMatch(/INV-|₹|\d{2,}/);
      }
    }
  });

  it("uses an announcement's title, tidied and shortened", () => {
    expect(pushText("ANNOUNCEMENT", "member", "Gym", "  Pool   reopens\nMonday ").body).toBe("New announcement: Pool reopens Monday");
    const long = pushText("ANNOUNCEMENT", "member", "Gym", "x".repeat(200)).body;
    expect(long.length).toBeLessThanOrEqual("New announcement: ".length + 80);
    expect(long.endsWith("…")).toBe(true);
  });

  it("maps each kind to the preference that controls it", () => {
    expect(preferenceFor("CLASS_REMINDER", "member")).toBe("classReminders");
    expect(preferenceFor("WAITLIST_PROMOTED", "member")).toBe("waitlist");
    expect(preferenceFor("PAYMENT_DUE", "member")).toBe("payments");
    expect(preferenceFor("MEMBERSHIP_EXPIRING", "member")).toBe("membership");
    expect(preferenceFor("MEMBERSHIP_EXPIRING", "staff")).toBe("staffAlerts");
    expect(preferenceFor("ANNOUNCEMENT", "staff")).toBe("announcements");
  });
});
