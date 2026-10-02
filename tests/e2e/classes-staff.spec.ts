import { expect, test, type Page } from "@playwright/test";
import { testDb } from "./db";
import { login, loginAndLand } from "./helpers";

type Row = Record<string, string>;
const rows = (sql: string) => testDb(async (db, schema) => (await db.query(sql.replaceAll("$S", `"${schema}"`))).rows as Row[]);

// Long multi-step flows; the dev server also compiles these routes on first visit.
test.describe.configure({ timeout: 90_000 });

const DAYS_AHEAD = 3;
const CLASS_DAY = `((now() AT TIME ZONE 'Asia/Kolkata')::date + ${DAYS_AHEAD})`;

function classDate() {
  const d = new Date(Date.now() + 5.5 * 3_600_000 + DAYS_AHEAD * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Members whose time-based membership covers the class date, so booking needs no credits. */
const eligibleMembers = (n: number) =>
  rows(`SELECT m."memberNumber" AS number, m."firstName" || ' ' || m."lastName" AS name FROM $S."Member" m JOIN $S."Gym" g ON g.id = m."gymId"
          JOIN $S."Membership" s ON s."memberId" = m.id
         WHERE g.slug = 'iron-temple' AND m."deletedAt" IS NULL AND s.status = 'ACTIVE' AND s."cancelledAt" IS NULL AND s."classCreditsRemaining" IS NULL
           AND s."startDate" <= ${CLASS_DAY} AND s."endDate" >= ${CLASS_DAY}
           AND NOT EXISTS (SELECT 1 FROM $S."MembershipFreeze" f WHERE f."membershipId" = s.id)
         ORDER BY m."memberNumber" LIMIT ${n}`);

async function book(page: Page, member: Row) {
  await page.getByRole("combobox").fill(`M-${member.number}`);
  await page.getByRole("option").filter({ hasText: member.name }).first().click();
  await page.getByRole("button", { name: /^(Book|Add to waitlist)$/ }).click();
}

test.describe("classes", () => {
  test("schedule a class, fill it, waitlist the overflow, and promote on cancellation", async ({ page }) => {
    const [a, b, c] = await eligibleMembers(3);
    await loginAndLand(page, "manager1@irontemple.example", /\/dashboard/);
    await page.getByRole("link", { name: "Classes" }).click();
    await page.getByRole("link", { name: "Schedule class" }).click();

    await page.getByLabel("Date").fill(classDate());
    await page.getByLabel("Starts").fill("22:40");
    const capacity = page.getByLabel("Capacity");
    await capacity.click();
    await capacity.press("Control+A");
    await capacity.fill("2");
    await page.getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByText("Class scheduled.")).toBeVisible();
    await expect(page).toHaveURL(/\/classes\?week=/);

    const [session] = await rows(`SELECT s.id FROM $S."ClassSession" s JOIN $S."Gym" g ON g.id = s."gymId" WHERE g.slug = 'iron-temple' ORDER BY s."createdAt" DESC LIMIT 1`);
    await page.goto(`/g/iron-temple/classes/${session.id}`);
    await expect(page.getByText("0/2 booked")).toBeVisible();

    await book(page, a);
    await expect(page.getByText(`${a.name} is booked.`)).toBeVisible();
    await book(page, b);
    await expect(page.getByText("2/2 booked")).toBeVisible();
    await expect(page.getByLabel("Add to the waitlist")).toBeVisible();
    await book(page, c);
    await expect(page.getByText(`Class is full — ${c.name} is #1 on the waitlist.`)).toBeVisible();
    await expect(page.getByText("1 on waitlist")).toBeVisible();

    await page.getByRole("button", { name: `Cancel booking for ${a.name}` }).click();
    await page.getByRole("button", { name: "Cancel booking", exact: true }).click();
    await expect(page.getByText("Booking cancelled — the next person on the waitlist got the spot.")).toBeVisible();
    await expect(page.getByText("Nobody waiting.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Booked (2)" }).or(page.getByText("Booked (2)"))).toBeVisible();
  });

  test("trainers see their own classes and schedule, without scheduling controls", async ({ page }) => {
    await loginAndLand(page, "trainer1@irontemple.example", /\/dashboard/);
    await page.getByRole("link", { name: "Classes" }).click();
    await expect(page.getByRole("heading", { name: "My classes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Schedule class" })).toHaveCount(0);
    await page.getByRole("link", { name: "My schedule" }).click();
    await expect(page.getByRole("heading", { name: "My schedule" })).toBeVisible();
    await page.goto("/g/iron-temple/classes/new");
    await expect(page.getByRole("heading", { name: /You don't have access/ })).toBeVisible();
  });
});

test.describe("staff invitations", () => {
  test("owner invites a trainer, who creates an account from the link; removing them ends access", async ({ page, browser }) => {
    const email = `e2e.coach.${Date.now()}@example.test`;
    await loginAndLand(page, "owner@irontemple.example", /\/dashboard/);
    await page.getByRole("link", { name: "Staff", exact: true }).click();
    await page.getByRole("button", { name: "Invite staff" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Role").selectOption("TRAINER");
    await page.getByRole("button", { name: "Send invitation" }).click();
    const link = await page.getByLabel("Invitation link").inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(email)).toBeVisible(); // pending list

    const guest = await browser.newContext();
    const invitee = await guest.newPage();
    await invitee.goto(new URL(link).pathname);
    await expect(invitee.getByRole("heading", { name: "Join Iron Temple Fitness" })).toBeVisible();
    await invitee.getByLabel("Your full name").fill("Eetu Coach");
    await invitee.getByLabel("Password", { exact: true }).fill("Coach-Pass-2026");
    await invitee.getByLabel("Confirm password").fill("Coach-Pass-2026");
    await invitee.getByRole("button", { name: "Create account & join" }).click();
    await expect(invitee).toHaveURL(/\/g\/iron-temple\/dashboard/, { timeout: 20_000 });

    // The link is single-use.
    await invitee.goto(new URL(link).pathname);
    await expect(invitee.getByText("This invitation has already been used.")).toBeVisible();

    await page.reload();
    await page.getByRole("link", { name: "Eetu Coach" }).click();
    await page.getByRole("button", { name: "Remove from gym" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText("Eetu Coach removed.")).toBeVisible();

    const res = await invitee.goto("/g/iron-temple/dashboard");
    expect(res?.status()).toBe(404);
    await guest.close();
  });

  test("front desk can't manage staff", async ({ page }) => {
    await login(page, "frontdesk1@irontemple.example");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await page.goto("/g/iron-temple/staff");
    await expect(page.getByRole("button", { name: "Invite staff" })).toHaveCount(0);
  });
});
