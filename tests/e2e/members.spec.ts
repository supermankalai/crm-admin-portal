import { expect, test, type Page } from "@playwright/test";
import { testDb } from "./db";
import { loginAndLand } from "./helpers";

const stamp = () => Date.now().toString(36).slice(-6);

async function addMember(page: Page, first: string, last: string, phone: string, email: string) {
  await page.goto("/g/iron-temple/members/new");
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Phone", { exact: true }).fill(phone);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contact name").fill("Kiran Rao");
  await page.getByLabel("Contact phone").fill("+91 90000 12345");
  await page.getByRole("button", { name: "Add member" }).click();
}

test.describe("members", () => {
  test("front desk adds a member, who can be found by phone and is stored encrypted", async ({ page }) => {
    const s = stamp();
    const phone = `98${Date.now().toString().slice(-8)}`;
    await loginAndLand(page, "frontdesk1@irontemple.example", /\/dashboard/);

    await page.goto("/g/iron-temple/members/new");
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("Enter a first name")).toBeVisible();

    await addMember(page, "Neha", `Test${s}`, phone, `neha.${s}@example.com`);
    // "/members/new" also matches a bare id pattern, so wait for the profile heading itself.
    await expect(page.getByRole("heading", { name: `Neha Test${s}` })).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(/\/members\/new$/);
    await expect(page.getByText("No membership")).toBeVisible();
    await expect(page.locator("dd").filter({ hasText: phone })).toBeVisible();

    await page.goto(`/g/iron-temple/members?q=${encodeURIComponent(`+91 ${phone.slice(0, 5)} ${phone.slice(5)}`)}`);
    await expect(page.getByRole("link", { name: new RegExp(`Neha Test${s}`) })).toBeVisible();

    const stored = await testDb(async (db, schema) => {
      const { rows } = await db.query(`SELECT "phoneEnc", "emergencyContactEnc" FROM "${schema}"."Member" WHERE "lastName" = $1`, [`Test${s}`]);
      return rows[0];
    });
    expect(stored.phoneEnc).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain(phone);
    expect(JSON.stringify(stored)).not.toContain("Kiran");
  });

  test("front desk can only edit contact details", async ({ page }) => {
    await loginAndLand(page, "frontdesk1@irontemple.example", /\/dashboard/);
    await page.goto("/g/iron-temple/members");
    await page.locator("table tbody tr a").first().click();
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByText("Your role can update contact details")).toBeVisible();
    await expect(page.getByLabel("First name")).toHaveCount(0);
    await expect(page.getByLabel("Phone", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });

  test("filters by status and shows each member's state", async ({ page }) => {
    await loginAndLand(page, "manager1@irontemple.example", /\/dashboard/);
    await page.goto("/g/iron-temple/members?status=frozen");
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();
    const badges = await rows.locator("td:nth-child(3)").allInnerTexts();
    expect(badges.length).toBeGreaterThan(0);
    expect(new Set(badges)).toEqual(new Set(["Frozen"]));
  });

  test("a manager freezes a membership and the end date moves out", async ({ page }) => {
    const target = await testDb(async (db, schema) => {
      const { rows } = await db.query(
        `SELECT s."memberId", to_char(s."endDate", 'YYYY-MM-DD') AS "endDate" FROM "${schema}"."Membership" s
           JOIN "${schema}"."MembershipPlan" p ON p.id = s."planId" JOIN "${schema}"."Gym" g ON g.id = s."gymId"
          WHERE g.slug = 'iron-temple' AND p."allowFreeze" AND s.status = 'ACTIVE' AND s."cancelledAt" IS NULL
            AND s."startDate" <= current_date AND s."endDate" > current_date + 3
            AND NOT EXISTS (SELECT 1 FROM "${schema}"."MembershipFreeze" f WHERE f."membershipId" = s.id)
          ORDER BY s."endDate" LIMIT 1`
      );
      return rows[0] as { memberId: string; endDate: string };
    });
    await loginAndLand(page, "manager1@irontemple.example", /\/dashboard/);
    await page.goto(`/g/iron-temple/members/${target.memberId}?tab=memberships`);
    await page.getByRole("button", { name: "Freeze" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Days").fill("5");
    await dialog.getByRole("button", { name: "Freeze" }).click();
    await expect(page.getByText(/Frozen until/)).toBeVisible();
    await expect(page.locator("table").getByText("Frozen", { exact: true })).toBeVisible();

    const end = await testDb(async (db, schema) => {
      const { rows } = await db.query(`SELECT to_char(MAX("endDate"), 'YYYY-MM-DD') AS e FROM "${schema}"."Membership" WHERE "memberId" = $1 AND status = 'FROZEN'`, [target.memberId]);
      return rows[0].e as string;
    });
    const expected = new Date(`${target.endDate}T00:00:00Z`);
    expected.setUTCDate(expected.getUTCDate() + 5);
    expect(end).toBe(expected.toISOString().slice(0, 10));
  });

  test("owners delete members after confirming", async ({ page }) => {
    const s = stamp();
    await loginAndLand(page, "owner@irontemple.example", /\/dashboard/);
    await addMember(page, "Temp", `Delete${s}`, `97${Date.now().toString().slice(-8)}`, `temp.${s}@example.com`);
    await expect(page.getByRole("heading", { name: `Temp Delete${s}` })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete member" }).click();
    await expect(page).toHaveURL(/\/g\/iron-temple\/members$/);
    await page.goto(`/g/iron-temple/members?q=Delete${s}`);
    await expect(page.getByText("No members match your search.")).toBeVisible();
  });

  test("trainers see only their own clients", async ({ page }) => {
    await loginAndLand(page, "trainer1@irontemple.example", /\/dashboard/);
    await page.getByRole("link", { name: "Members" }).click();
    await expect(page.getByRole("heading", { name: "My clients" })).toBeVisible();
    const shown = await page.locator("table tbody tr").count();
    const assigned = await testDb(async (db, schema) => {
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM "${schema}"."TrainerClient" tc JOIN "${schema}"."StaffMember" s ON s.id = tc."trainerId"
           JOIN "${schema}"."User" u ON u.id = s."userId" JOIN "${schema}"."Member" m ON m.id = tc."memberId"
          WHERE u.email = 'trainer1@irontemple.example' AND m."deletedAt" IS NULL`
      );
      return rows[0].n as number;
    });
    expect(shown).toBe(Math.min(assigned, 25));
    await expect(page.getByRole("link", { name: "Add member" })).toHaveCount(0);
  });
});

test.describe("membership plans", () => {
  test("a manager creates, edits and archives a plan", async ({ page }) => {
    const name = `Student ${stamp()}`;
    await loginAndLand(page, "manager1@irontemple.example", /\/dashboard/);
    await page.getByRole("link", { name: "Membership plans" }).click();
    await page.getByRole("button", { name: "New plan" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel(/^Price/).fill("1,499.50");
    await dialog.getByLabel("Members may freeze this membership").check();
    await dialog.getByLabel("Maximum freeze days per membership").fill("7");
    await dialog.getByRole("button", { name: "Save plan" }).click();
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("₹1,499.50");
    await expect(row).toContainText("Up to 7 days");

    // Duplicate name (case-insensitive) is refused on the field.
    await page.getByRole("button", { name: "New plan" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill(name.toUpperCase());
    await page.getByRole("dialog").getByLabel(/^Price/).fill("10");
    await page.getByRole("dialog").getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByRole("dialog").getByText("A plan with this name already exists.")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: `Archive ${name}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive plan" }).click();
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
  });

  test("front desk can view plans but not change them", async ({ page }) => {
    await loginAndLand(page, "frontdesk1@irontemple.example", /\/dashboard/);
    await page.goto("/g/iron-temple/plans");
    await expect(page.getByRole("heading", { name: "Membership plans" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New plan" })).toHaveCount(0);
  });
});

test.describe("dashboard", () => {
  test("owners see live figures and charts; front desk sees no revenue", async ({ page }) => {
    await loginAndLand(page, "owner@irontemple.example", /\/dashboard/);
    for (const label of ["Active members", "New sign-ups this month", "Revenue today", "Revenue this month", "Check-ins today", "Expiring in 7 days"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("img", { name: /net revenue/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /active members/ })).toBeVisible();

    const active = await testDb(async (db, schema) => {
      const { rows } = await db.query(
        `SELECT count(DISTINCT s."memberId")::int AS n FROM "${schema}"."Membership" s JOIN "${schema}"."Member" m ON m.id = s."memberId"
           JOIN "${schema}"."Gym" g ON g.id = s."gymId"
          WHERE g.slug = 'iron-temple' AND m."deletedAt" IS NULL AND s.status IN ('ACTIVE','FROZEN')
            AND s."startDate" <= (now() AT TIME ZONE 'Asia/Kolkata')::date AND s."endDate" >= (now() AT TIME ZONE 'Asia/Kolkata')::date
            AND NOT EXISTS (SELECT 1 FROM "${schema}"."MembershipFreeze" f WHERE f."membershipId" = s.id
                            AND f."startDate" <= (now() AT TIME ZONE 'Asia/Kolkata')::date AND f."endDate" >= (now() AT TIME ZONE 'Asia/Kolkata')::date)`
      );
      return rows[0].n as number;
    });
    await expect(page.getByText("Active members", { exact: true }).locator("xpath=../..")).toContainText(String(active));

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await loginAndLand(page, "frontdesk1@irontemple.example", /\/dashboard/);
    await expect(page.getByText("Revenue today")).toHaveCount(0);
    await expect(page.getByText("Check-ins today")).toBeVisible();
  });
});
