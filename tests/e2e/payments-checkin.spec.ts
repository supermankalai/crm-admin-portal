import { expect, test, type Page } from "@playwright/test";
import { testDb } from "./db";
import { loginAndLand } from "./helpers";

type Row = Record<string, string>;
const one = (sql: string) => testDb(async (db, schema) => (await db.query(sql.replaceAll("$S", `"${schema}"`))).rows[0] as Row);

const LOCAL_TODAY = "(now() AT TIME ZONE 'Asia/Kolkata')::date";
const activeMemberCode = () =>
  one(`SELECT m."checkInCode" AS code, m."firstName" || ' ' || m."lastName" AS name FROM $S."Member" m JOIN $S."Gym" g ON g.id = m."gymId"
        JOIN $S."Membership" s ON s."memberId" = m.id
       WHERE g.slug = 'iron-temple' AND m."deletedAt" IS NULL AND s.status = 'ACTIVE' AND s."cancelledAt" IS NULL
         AND s."startDate" <= ${LOCAL_TODAY} AND s."endDate" >= ${LOCAL_TODAY}
         AND NOT EXISTS (SELECT 1 FROM $S."MembershipFreeze" f WHERE f."membershipId" = s.id)
         AND NOT EXISTS (SELECT 1 FROM $S."CheckIn" c WHERE c."memberId" = m.id AND c."checkedInAt" > now() - interval '10 minutes')
       ORDER BY m."memberNumber" LIMIT 1`);
const expiredMember = () =>
  one(`SELECT m.id, m."memberNumber" AS number, m."firstName" || ' ' || m."lastName" AS name FROM $S."Member" m JOIN $S."Gym" g ON g.id = m."gymId"
       WHERE g.slug = 'iron-temple' AND m."deletedAt" IS NULL
         AND EXISTS (SELECT 1 FROM $S."Membership" s WHERE s."memberId" = m.id)
         AND NOT EXISTS (SELECT 1 FROM $S."Membership" s WHERE s."memberId" = m.id AND s."endDate" >= ${LOCAL_TODAY})
       ORDER BY m."memberNumber" DESC LIMIT 1`);

async function scan(page: Page, value: string) {
  const box = page.getByLabel("Member name, member ID or QR code");
  await box.fill(value);
  await box.press("Enter");
}

test.describe("check-in", () => {
  test("a QR scan checks an active member in, and a quick re-scan is not counted twice", async ({ page }) => {
    const member = await activeMemberCode();
    await loginAndLand(page, "frontdesk1@irontemple.example", /\/dashboard/);
    await page.getByRole("link", { name: "Check-in" }).click();
    const before = Number(await page.getByText("Checked in today").locator("xpath=../..").locator(".text-2xl").innerText());

    await scan(page, `FITCRM:${member.code}`);
    await expect(page.getByRole("status").filter({ hasText: `Welcome — ${member.name}` })).toBeVisible();
    await expect(page.getByRole("list", { name: "Today's check-ins" })).toContainText(member.name);

    await scan(page, member.code); // handheld scanners may type just the code
    await expect(page.getByRole("status").filter({ hasText: `Already checked in — ${member.name}` })).toBeVisible();
    await expect(page.getByText("Checked in today").locator("xpath=../..").locator(".text-2xl")).toHaveText(String(before + 1));
  });

  test("an expired member is blocked with the reason, the attempt is recorded, and staff can renew", async ({ page }) => {
    const member = await expiredMember();
    await loginAndLand(page, "frontdesk1@irontemple.example", /\/dashboard/);
    await page.goto("/g/iron-temple/check-in");
    await scan(page, `M-${member.number}`);
    const status = page.getByRole("status").filter({ hasText: "Entry denied" });
    await expect(status).toContainText(member.name);
    await expect(status).toContainText(/Membership (expired on|was cancelled)/);
    const denied = await one(`SELECT count(*)::int AS n FROM $S."CheckIn" WHERE "memberId" = '${member.id}' AND result <> 'ALLOWED' AND "checkedInAt" > now() - interval '5 minutes'`);
    expect(Number(denied.n)).toBe(1);

    // Renew from the denial, pay in full, then the member gets in.
    await status.getByRole("link", { name: "Renew membership" }).click();
    await expect(page.getByRole("heading", { name: "Sell membership" })).toBeVisible();
    await expect(page.getByText(member.name)).toBeVisible();
    await page.getByRole("button", { name: "Sell membership" }).click();
    await expect(page).toHaveURL(/\/g\/iron-temple\/invoices\//, { timeout: 20_000 });
    await expect(page.locator("main header").getByText("Paid", { exact: true })).toBeVisible();

    await page.goto("/g/iron-temple/check-in");
    await scan(page, `M-${member.number}`);
    await expect(page.getByRole("status").filter({ hasText: `Welcome — ${member.name}` })).toBeVisible();
  });

  test("trainers have no check-in access", async ({ page }) => {
    await loginAndLand(page, "trainer1@irontemple.example", /\/dashboard/);
    await expect(page.getByRole("link", { name: "Check-in" })).toHaveCount(0);
    await page.goto("/g/iron-temple/check-in");
    await expect(page.getByRole("heading", { name: "You don't have access to check-in" })).toBeVisible();
  });
});

test.describe("payments", () => {
  test("front desk records a payment on an overdue invoice; it leaves the overdue list", async ({ page }) => {
    const invoice = await one(`SELECT i.id, i.number FROM $S."Invoice" i JOIN $S."Gym" g ON g.id = i."gymId"
                                WHERE g.slug = 'iron-temple' AND i.status = 'OPEN' AND i."dueDate" < ${LOCAL_TODAY} ORDER BY i.number LIMIT 1`);
    const label = `INV-${String(invoice.number).padStart(6, "0")}`;
    await loginAndLand(page, "frontdesk1@irontemple.example", /\/dashboard/);
    await page.goto("/g/iron-temple/payments?view=invoices&status=overdue");
    await page.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`/invoices/${invoice.id}`));
    await expect(page.locator("main header").getByText("Overdue", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Record payment" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Method").selectOption("TRANSFER");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog.getByText("Add the transfer / UPI reference")).toBeVisible();
    await dialog.getByLabel(/Reference/).fill("UTR998877");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText(/invoice paid in full/)).toBeVisible();
    await expect(page.locator("main header").getByText("Paid", { exact: true })).toBeVisible();
    await expect(page.getByText("UTR998877")).toBeVisible();

    await page.goto("/g/iron-temple/payments?view=invoices&status=overdue");
    await expect(page.getByRole("link", { name: label })).toHaveCount(0);
    // Front desk cannot refund.
    await page.goto(`/g/iron-temple/invoices/${invoice.id}`);
    await expect(page.getByRole("button", { name: "Refund" })).toHaveCount(0);
  });

  test("a manager refunds part of a payment; the invoice shows it and the totals update", async ({ page }) => {
    const pay = await one(`SELECT p."invoiceId" AS "invoiceId", p."amountMinor" AS amount FROM $S."Payment" p JOIN $S."Gym" g ON g.id = p."gymId"
                           WHERE g.slug = 'iron-temple' AND p.status = 'COMPLETED' AND p."invoiceId" IS NOT NULL
                             AND (SELECT count(*) FROM $S."Payment" x WHERE x."invoiceId" = p."invoiceId") = 1
                           ORDER BY p."receivedAt" DESC LIMIT 1`);
    await loginAndLand(page, "manager1@irontemple.example", /\/dashboard/);
    await page.goto(`/g/iron-temple/invoices/${pay.invoiceId}`);
    await page.getByRole("button", { name: "Refund" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Amount/).fill(String(Number(pay.amount) / 100 + 1)); // more than paid
    await dialog.getByLabel("Reason").fill("Facility closed two days");
    await dialog.getByRole("button", { name: "Record refund" }).click();
    await expect(page.getByText(/cannot be more than the amount still refundable/)).toBeVisible();

    await dialog.getByLabel(/Amount/).fill("500");
    await dialog.getByRole("button", { name: "Record refund" }).click();
    await expect(page.getByText("Refund recorded.")).toBeVisible();
    await expect(page.getByText(/Refunded ₹500\.00 on .* — Facility closed two days/)).toBeVisible();
    const status = await one(`SELECT status FROM $S."Payment" WHERE "invoiceId" = '${pay.invoiceId}'`);
    expect(status.status).toBe("PARTIALLY_REFUNDED");
  });

  test("a new member is sold a membership with part payment, leaving a balance", async ({ page }) => {
    const s = Date.now().toString(36).slice(-6);
    await loginAndLand(page, "frontdesk1@irontemple.example", /\/dashboard/);
    await page.goto("/g/iron-temple/members/new");
    await page.getByLabel("First name").fill("Pay");
    await page.getByLabel("Last name").fill(`Later${s}`);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByRole("heading", { name: `Pay Later${s}` })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("link", { name: "Sell membership" }).click();
    const monthly = await page.locator("#planId option", { hasText: "Monthly Standard" }).first().getAttribute("value");
    await page.getByLabel("Plan").selectOption(monthly!);
    await page.getByLabel("Part payment now").check();
    await page.getByLabel(/Amount received/).fill("1000");
    await page.getByRole("button", { name: "Sell membership" }).click();
    await expect(page).toHaveURL(/\/invoices\//, { timeout: 20_000 });
    await expect(page.locator("main header").getByText("Open", { exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /Balance due/ })).toBeVisible();
    await expect(page.getByText("₹1,000.00 · Cash")).toBeVisible();
  });

  test("the payments list shows totals for the period", async ({ page }) => {
    await loginAndLand(page, "owner@irontemple.example", /\/dashboard/);
    await page.getByRole("link", { name: "Payments" }).click();
    for (const label of ["Received", "Refunded", "Net", "By method"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    await expect(page.locator("table tbody tr").first()).toBeVisible();
  });
});
