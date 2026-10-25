import { expect, test } from "@playwright/test";
import { testDb } from "./db";
import { loginAndLand } from "./helpers";

/**
 * Live sessions on the web portal: scheduling online classes, booking online PT, and the
 * trainer's way into the call. The e2e server uses a throwaway LiveKit key and address, so the
 * video connection itself isn't exercised here (see tests/integration/live-sessions.test.ts for
 * the token rules).
 */

const OWNER = "owner@irontemple.example";
const DESK = "frontdesk1@irontemple.example";

/** The demo member and one of their Iron Temple trainers. */
async function demoPair() {
  return testDb(async (db, schema) => {
    const r = await db.query(
      `SELECT m.id AS member, m."gymId" AS gym, m."firstName" || ' ' || m."lastName" AS name, s.id AS trainer, tu.email AS email
         FROM "${schema}"."MemberAccount" a
         JOIN "${schema}"."User" u ON u.id = a."userId" AND u.email = 'member1@irontemple.example'
         JOIN "${schema}"."Member" m ON m.id = a."memberId"
         JOIN "${schema}"."TrainerClient" tc ON tc."memberId" = m.id
         JOIN "${schema}"."StaffMember" s ON s.id = tc."trainerId"
         JOIN "${schema}"."User" tu ON tu.id = s."userId" AND tu.email LIKE 'trainer%@irontemple.example'
        ORDER BY tu.email LIMIT 1`
    );
    return r.rows[0] as { member: string; gym: string; name: string; trainer: string; email: string };
  });
}

test.describe("live sessions", () => {
  test("an owner schedules an online class without a room", async ({ page }) => {
    await loginAndLand(page, OWNER, /\/g\/iron-temple\/dashboard/);
    await page.goto("/g/iron-temple/classes/new");
    await expect(page.getByRole("heading", { name: "Schedule a class", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Room")).toBeVisible();
    // The dev server may still be hydrating the form: choose again until it responds.
    await expect(async () => {
      await page.getByLabel("Where").selectOption("ONLINE");
      await expect(page.getByLabel("Room")).toHaveCount(0, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    // Late evening, four weeks out: clear of the seeded classes.
    const day = new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("Date").fill(day);
    await page.getByLabel("Starts").fill("22:10");
    await page.getByLabel("Capacity").fill("40");
    await page.getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByText("Class scheduled.")).toBeVisible();
    await expect(page.getByText(/· Online/).first()).toBeVisible();

    const row = await testDb(async (db, schema) => {
      const r = await db.query(`SELECT "roomId", "deliveryMode", capacity FROM "${schema}"."ClassSession" WHERE capacity = 40 AND "deliveryMode" = 'ONLINE' ORDER BY "createdAt" DESC LIMIT 1`);
      return r.rows[0];
    });
    expect(row).toEqual({ roomId: null, deliveryMode: "ONLINE", capacity: 40 });
  });

  test("a trainer books an online PT session, then joins the call from their schedule; others can't", async ({ page, browser }) => {
    const demo = await demoPair();
    await loginAndLand(page, demo.email, /\/g\/iron-temple\/dashboard/);

    // Booking: "Where" offers online.
    await page.goto(`/g/iron-temple/pt/clients/${demo.member}`);
    await page.getByRole("button", { name: "Book session" }).click();
    const dialog = page.getByRole("dialog");
    const day = new Date(Date.now() + 22 * 86_400_000).toISOString().slice(0, 10);
    await dialog.getByLabel("Date").fill(day);
    await dialog.getByLabel("Start").fill("21:45");
    await dialog.getByLabel("Minutes").fill("30");
    await dialog.getByLabel("Where").selectOption("ONLINE");
    await dialog.getByLabel("Focus (optional)").fill("Remote check-in");
    await dialog.getByRole("button", { name: "Book session" }).click();
    await expect(page.getByText(/Session booked/)).toBeVisible();
    await expect(page.getByText("Online").first()).toBeVisible();

    // A session starting in a few minutes: the call is open.
    const sessionId = await testDb(async (db, schema) => {
      const r = await db.query(
        `INSERT INTO "${schema}"."TrainingSession" (id, "gymId", "trainerId", "memberId", "startsAt", "endsAt", focus, "deliveryMode", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, now() + interval '3 minutes', now() + interval '33 minutes', 'Live now', 'ONLINE', now()) RETURNING id`,
        [demo.gym, demo.trainer, demo.member]
      );
      return r.rows[0].id as string;
    });

    await page.goto("/g/iron-temple/schedule");
    const item = page.getByRole("listitem").filter({ hasText: "Live now" });
    await item.getByRole("link", { name: "Join call" }).click();
    await expect(page).toHaveURL(new RegExp(`/g/iron-temple/live/pt/${sessionId}$`));
    await expect(page.getByRole("heading", { name: "Personal training: Live now", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Your client joins from the app.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Join call" })).toBeEnabled();

    // Owners and front desk don't join calls.
    for (const email of [OWNER, DESK]) {
      const other = await (await browser.newContext()).newPage();
      await loginAndLand(other, email, /\/g\/iron-temple\/dashboard/);
      await other.goto(`/g/iron-temple/live/pt/${sessionId}`);
      await expect(other.getByText("Only the session's trainer and client can join this call.")).toBeVisible({ timeout: 30_000 });
      await expect(other.getByRole("button", { name: "Join call" })).toHaveCount(0);
      await other.context().close();
    }
  });
});
