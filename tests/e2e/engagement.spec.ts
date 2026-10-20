import { expect, test } from "@playwright/test";
import { testDb } from "./db";
import { loginAndLand } from "./helpers";

/** Mobile Phase 6 web portal additions: announcements, deletion requests, app invites, workout plans. */

const OWNER = "owner@irontemple.example";
const DESK = "frontdesk1@irontemple.example";

test.describe("announcements", () => {
  test("an owner publishes one to members and it reaches their app inbox", async ({ page }) => {
    await loginAndLand(page, OWNER, /\/g\/iron-temple\/dashboard/);
    await page.getByRole("link", { name: "Announcements" }).click();
    await expect(page.getByRole("heading", { name: "Announcements", level: 1 })).toBeVisible();
    const title = `Sauna closed ${Date.now()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Message").fill("The sauna is closed for maintenance until Monday.");
    await expect(page.getByText("49 / 2000 characters")).toBeVisible();
    await page.getByLabel("Members (app users)").check();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText(/Published to \d+ people/)).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();

    const counts = await testDb(async (db, schema) => {
      const r = await db.query(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE s.id IS NOT NULL)::int AS staff
           FROM "${schema}"."Notification" n
           JOIN "${schema}"."Announcement" a ON a.id = n."entityId" AND a.title = $1
           LEFT JOIN "${schema}"."StaffMember" s ON s."userId" = n."recipientUserId" AND s."gymId" = n."gymId"`,
        [title]
      );
      return r.rows[0] as { n: number; staff: number };
    });
    expect(counts.n).toBeGreaterThanOrEqual(20);
    expect(counts.staff).toBe(0);
  });

  test("the front desk can't open announcements or deletion requests", async ({ page }) => {
    await loginAndLand(page, DESK, /\/g\/iron-temple\/dashboard/);
    await page.goto("/g/iron-temple/announcements");
    await expect(page.getByText(/don.t have access to announcements/i)).toBeVisible();
    await page.goto("/g/iron-temple/deletion-requests");
    await expect(page.getByText(/don.t have access to deletion requests/i)).toBeVisible();
  });
});

test.describe("account deletion requests", () => {
  test("an owner sees the waiting request from the Members page and rejects it with a note", async ({ page }) => {
    await loginAndLand(page, OWNER, /\/g\/iron-temple\/dashboard/);
    await page.goto("/g/iron-temple/members");
    await page.getByRole("link", { name: "1 deletion request" }).click();
    await expect(page.getByText("Moving to another city.")).toBeVisible();
    await page.getByLabel(/Note \(optional/).fill("Please settle your open invoice first.");
    await page.getByRole("button", { name: "Reject" }).click();
    await page.getByRole("button", { name: "Reject request" }).click();
    await expect(page.getByText("Request rejected.")).toBeVisible();
    await expect(page.getByText("Rejected", { exact: true })).toBeVisible();
  });
});

test.describe("member app invites", () => {
  test("the front desk shows a one-time code for a member without the app", async ({ page }) => {
    const memberId = await testDb(async (db, schema) => {
      const r = await db.query(
        `SELECT m.id FROM "${schema}"."Member" m JOIN "${schema}"."Gym" g ON g.id = m."gymId" AND g.slug = 'iron-temple'
          WHERE m."deletedAt" IS NULL AND m.email IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "${schema}"."MemberAccount" a WHERE a."memberId" = m.id)
            AND NOT EXISTS (SELECT 1 FROM "${schema}"."MemberAppInvite" i WHERE i."memberId" = m.id AND i."usedAt" IS NULL AND i."revokedAt" IS NULL)
          ORDER BY m."memberNumber" DESC LIMIT 1`
      );
      return r.rows[0].id as string;
    });
    await loginAndLand(page, DESK, /\/g\/iron-temple\/dashboard/);
    await page.goto(`/g/iron-temple/members/${memberId}`);
    await expect(page.getByText("Not set up")).toBeVisible();
    await page.getByRole("button", { name: "Show a code" }).click();
    await expect(page.getByText(/It isn.t shown again/)).toBeVisible();
    await expect(page.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)).toBeVisible();
    await expect(page.getByText("Invited")).toBeVisible();
  });
});

test.describe("workout plans", () => {
  test("an owner writes a template with two days and finds it in the list", async ({ page }) => {
    await loginAndLand(page, OWNER, /\/g\/iron-temple\/dashboard/);
    await page.goto("/g/iron-temple/workouts");
    await expect(page.getByRole("heading", { name: "Workout plans", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Strength foundations" }).first()).toBeVisible();
    await page.getByRole("link", { name: "New template" }).click();
    const title = `Mobility basics ${Date.now()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Exercise 1").fill("Cat-cow");
    await page.getByRole("button", { name: "Add a day" }).click();
    await page.getByRole("group", { name: "Day 2" }).getByLabel("Exercise 1").fill("World's greatest stretch");
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("World's greatest stretch")).toBeVisible();
    await expect(page.getByText("Template", { exact: true })).toBeVisible();
  });

  test("a plan with no exercise name is refused with the field highlighted", async ({ page }) => {
    await loginAndLand(page, OWNER, /\/g\/iron-temple\/dashboard/);
    await page.goto("/g/iron-temple/workouts/new");
    await page.getByLabel("Title").fill("Incomplete");
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByText("Name the exercise")).toBeVisible();
    await expect(page.getByLabel("Exercise 1")).toHaveAttribute("aria-invalid", "true");
  });
});
