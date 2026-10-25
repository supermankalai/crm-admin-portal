import { expect, test } from "@playwright/test";
import { testDb } from "./db";
import { loginAndLand } from "./helpers";

/** Personal training module (web): overview, assigning with a goal, client results, sessions. */

const OWNER = "owner@irontemple.example";
const TRAINER = "trainer1@irontemple.example";

/**
 * The demo member (member1@…): a client with a weight-loss goal and 12 weeks of measurements, and
 * one of their Iron Temple trainers (trainerN@…, who only works at this gym).
 */
async function demoMember() {
  return testDb(async (db, schema) => {
    const r = await db.query(
      `SELECT m.id, m."firstName" || ' ' || m."lastName" AS name, tu.email AS trainer FROM "${schema}"."MemberAccount" a
         JOIN "${schema}"."User" u ON u.id = a."userId" AND u.email = 'member1@irontemple.example'
         JOIN "${schema}"."Member" m ON m.id = a."memberId"
         JOIN "${schema}"."TrainerClient" tc ON tc."memberId" = m.id
         JOIN "${schema}"."StaffMember" s ON s.id = tc."trainerId"
         JOIN "${schema}"."User" tu ON tu.id = s."userId" AND tu.email LIKE 'trainer%@irontemple.example'
        ORDER BY tu.email LIMIT 1`
    );
    return r.rows[0] as { id: string; name: string; trainer: string };
  });
}

test.describe("personal training", () => {
  test("an owner sees the overview and a client's progress toward their goal", async ({ page }) => {
    const demo = await demoMember();
    await loginAndLand(page, OWNER, /\/g\/iron-temple\/dashboard/);
    await page.getByRole("link", { name: "Personal training" }).click();
    // The dev server compiles the page on first visit.
    await expect(page.getByRole("heading", { name: "Personal training", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Trainers this month")).toBeVisible();

    await page.getByRole("link", { name: "Clients", exact: true }).click();
    await page.getByLabel("Filter by goal").selectOption("WEIGHT_LOSS");
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("link", { name: demo.name }).click();
    await expect(page.getByRole("heading", { name: demo.name, level: 1 })).toBeVisible();
    // One bar per trainer with a weight target (the demo member has two trainers).
    await expect(page.getByRole("progressbar", { name: "Weight target progress" }).first()).toBeVisible();
    await expect(page.getByText(/% of the way/).first()).toBeVisible();
    await expect(page.getByText(/Private to the member and their assigned trainers/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit goal" }).first()).toBeVisible();
  });

  test("assigning a trainer notifies the member's trainer, and the trainer sees the new client", async ({ page, browser }) => {
    // A member who isn't trainer1's client yet.
    const target = await testDb(async (db, schema) => {
      const r = await db.query(
        `SELECT m.id, m."memberNumber" AS n, m."firstName" || ' ' || m."lastName" AS name, s.id AS trainer, s."userId" AS "trainerUser"
           FROM "${schema}"."Member" m
           JOIN "${schema}"."Gym" g ON g.id = m."gymId" AND g.slug = 'iron-temple'
           JOIN "${schema}"."StaffMember" s ON s."gymId" = g.id
           JOIN "${schema}"."User" u ON u.id = s."userId" AND u.email = $1
          WHERE m."deletedAt" IS NULL
            AND NOT EXISTS (SELECT 1 FROM "${schema}"."TrainerClient" tc WHERE tc."memberId" = m.id AND tc."trainerId" = s.id)
          ORDER BY m."memberNumber" DESC LIMIT 1`,
        [TRAINER]
      );
      return r.rows[0] as { id: string; n: number; name: string; trainer: string; trainerUser: string };
    });

    await loginAndLand(page, OWNER, /\/g\/iron-temple\/dashboard/);
    await page.goto("/g/iron-temple/pt/clients");
    await page.getByRole("button", { name: "Assign trainer" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Member" }).fill(`M-${String(target.n).padStart(6, "0")}`);
    await dialog.getByRole("option").first().getByRole("button").click();
    await dialog.getByLabel("Trainer").selectOption(target.trainer);
    await dialog.getByLabel("Goal", { exact: true }).selectOption("STRENGTH");
    await dialog.getByLabel("Target weight (kg)").fill("78");
    await dialog.getByRole("button", { name: "Assign and notify" }).click();
    await expect(page.getByText(/Both have been notified/)).toBeVisible();

    const alerts = await testDb(async (db, schema) => {
      const r = await db.query(`SELECT count(*)::int AS n FROM "${schema}"."Notification" WHERE type = 'PT_ASSIGNED' AND "recipientUserId" = $1 AND body LIKE $2`, [target.trainerUser, `${target.name}%`]);
      return r.rows[0].n as number;
    });
    expect(alerts).toBe(1);

    // The trainer sees them in their (own-clients-only) list, and can't assign anyone.
    const trainerPage = await (await browser.newContext()).newPage();
    await loginAndLand(trainerPage, TRAINER, /\/g\/iron-temple\/dashboard/);
    await trainerPage.goto("/g/iron-temple/pt/clients");
    await expect(trainerPage.getByRole("heading", { name: "PT clients", level: 1 })).toBeVisible();
    await expect(trainerPage.getByRole("link", { name: target.name })).toBeVisible();
    await expect(trainerPage.getByRole("button", { name: "Assign trainer" })).toHaveCount(0);
  });

  test("a trainer books a session with a client from the client's page", async ({ page }) => {
    const demo = await demoMember();
    await loginAndLand(page, demo.trainer, /\/g\/iron-temple\/dashboard/);
    await page.goto(`/g/iron-temple/pt/clients/${demo.id}`);
    await page.getByRole("button", { name: "Book session" }).click();
    const dialog = page.getByRole("dialog");
    // Late evening, three weeks out: clear of the seeded early-morning sessions and classes.
    const day = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
    await dialog.getByLabel("Date").fill(day);
    await dialog.getByLabel("Start").fill("21:15");
    await dialog.getByLabel("Minutes").fill("45");
    await dialog.getByLabel("Focus (optional)").fill("Deadlift technique");
    await dialog.getByRole("button", { name: "Book session" }).click();
    await expect(page.getByText(/Session booked/)).toBeVisible();
    await expect(page.getByText("Deadlift technique").first()).toBeVisible();
  });
});

test.describe("PT packages", () => {
  test("an owner adds a package to the catalog", async ({ page }) => {
    await loginAndLand(page, OWNER, /\/g\/iron-temple\/dashboard/);
    await page.goto("/g/iron-temple/pt/packages");
    await expect(page.getByRole("heading", { name: "PT packages", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("cell", { name: "10 sessions" }).first()).toBeVisible();
    await page.getByRole("button", { name: "New package" }).click();
    const dialog = page.getByRole("dialog");
    const name = `Trial pack ${Date.now()}`;
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Sessions").fill("3");
    await dialog.getByLabel(/^Price/).fill("3000");
    await dialog.getByLabel("Valid for (days)").fill("21");
    await dialog.getByRole("button", { name: "Add package" }).click();
    await expect(page.getByText("Package added.")).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
    // The owner-only booking rule is on the same page.
    await expect(page.getByLabel(/PT sessions need a package credit/)).toBeVisible();
  });

  test("the front desk sells one from a member's profile and it shows with its invoice", async ({ page }) => {
    const demo = await demoMember();
    await loginAndLand(page, "frontdesk1@irontemple.example", /\/g\/iron-temple\/dashboard/);
    await page.goto(`/g/iron-temple/members/${demo.id}`);
    await page.getByRole("button", { name: "Sell PT package" }).click();
    const dialog = page.getByRole("dialog");
    const option = dialog.locator("#sell-package option", { hasText: /^20 sessions/ });
    await dialog.getByLabel("Package").selectOption((await option.getAttribute("value"))!);
    await expect(dialog.getByText(/20 sessions, usable until/)).toBeVisible();
    await dialog.getByRole("button", { name: "Sell package" }).click();
    await expect(page.getByText(/INV-\d{6} issued for/)).toBeVisible();
    await expect(page.getByText("20 sessions", { exact: true })).toBeVisible();
    await expect(page.getByText(/20 of 20/)).toBeVisible();
  });

  test("an owner sees the trainer report", async ({ page }) => {
    await loginAndLand(page, OWNER, /\/g\/iron-temple\/dashboard/);
    await page.goto("/g/iron-temple/reports?tab=trainers");
    await expect(page.getByText("PT sessions done by trainer")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("columnheader", { name: "Package sales" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", /\/reports\/trainers\?/);
  });
});
