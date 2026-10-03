import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, fromDateString, localDate, localDateTime } from "@/domain/dates";
import { lastMonthStarts, monthLastDay } from "@/domain/reports";
import { appDb } from "@/server/db/client";
import { FeatureNotInPlanError, ForbiddenError, NotFoundError, PlanLimitError, ValidationError } from "@/server/errors";
import { listAuditLog } from "@/server/services/audit-log";
import { readGymFile } from "@/server/services/members/commands";
import { listNotifications, markAllNotificationsRead, markNotificationRead, refreshNotifications, unreadNotificationCount } from "@/server/services/notifications";
import { attendanceReport, classReport, exportReport, retentionReport, revenueReport } from "@/server/services/reports";
import { getSettings, saveLocation, saveOpeningHours, setGymLogo, updateGymProfile } from "@/server/services/settings";
import { inTenant } from "@/server/tenant/guards";
import { resolveTenant } from "@/server/tenant/resolve";
import type { TenantContext } from "@/server/tenant/types";
import { createTwoGyms, type World } from "../support/fixtures";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const TZ = "Asia/Kolkata";
const u = (x: { id: string; name: string; email: string }) => ({ ...x, isSuperAdmin: false });
const today = () => localDate(new Date(), TZ);
const week = () => ({ from: addDays(today(), -6), to: today() });

let w: World;
let ownerA: TenantContext;
let deskA: TenantContext;
let managerA: TenantContext;
let ownerB: TenantContext;
let locationA: string;
let locationB: string;
let planId: string;
const members: Record<string, string> = {};

async function member(key: string, n: number, firstName = key) {
  members[key] = (await getOwnerDb().member.create({ data: { gymId: w.gymA.id, memberNumber: 100 + n, firstName, lastName: "Test", checkInCode: `RPT${String(n).padStart(7, "0")}` } })).id;
  return members[key];
}

const membership = (memberId: string, start: string, end: string, extra: { cancelledAt?: Date; status?: "ACTIVE" | "CANCELLED" } = {}) =>
  getOwnerDb().membership.create({
    data: { id: createId(), gymId: w.gymA.id, memberId, planId, startDate: fromDateString(start as never), endDate: fromDateString(end as never), priceMinor: 100, ...extra },
  });

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const owner = getOwnerDb();
  const plan = await owner.platformPlan.update({ where: { code: "TEST" }, data: { maxMembers: 100, maxStaff: 10, maxLocations: 2 } });
  for (const g of [w.gymA, w.gymB]) {
    await owner.gym.update({ where: { id: g.id }, data: { status: "ACTIVE", timezone: TZ } });
    await owner.gymSubscription.create({ data: { gymId: g.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  }
  const mgrUser = await owner.user.create({ data: { email: "mgr.rpt@test.example", name: "Manager A", passwordHash: "$argon2id$x" } });
  await owner.staffMember.create({ data: { gymId: w.gymA.id, userId: mgrUser.id, role: "MANAGER" } });
  locationA = (await owner.location.create({ data: { gymId: w.gymA.id, name: "Main" } })).id;
  locationB = (await owner.location.create({ data: { gymId: w.gymB.id, name: "Main" } })).id;
  planId = (await owner.membershipPlan.create({ data: { gymId: w.gymA.id, name: "Monthly", type: "MONTHLY", priceMinor: 100, durationDays: 30 } })).id;

  ownerA = (await resolveTenant(u(w.users.ownerA), "gym-a"))!;
  deskA = (await resolveTenant(u(w.users.deskA), "gym-a"))!;
  managerA = (await resolveTenant(u(mgrUser), "gym-a"))!;
  ownerB = (await resolveTenant(u(w.users.ownerB), "gym-b"))!;

  // ── Money: two payments in gym A (one refunded in part), one big payment in gym B ──
  const yesterdayMorning = localDateTime(addDays(today(), -1), "10:00", TZ);
  const cash = await owner.payment.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, amountMinor: 10_000, currency: "INR", method: "CASH", receivedAt: yesterdayMorning, recordedById: w.staff.ownerA.id } });
  await owner.payment.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, amountMinor: 5_000, currency: "INR", method: "CARD", receivedAt: yesterdayMorning, recordedById: w.staff.ownerA.id } });
  await owner.refund.create({ data: { gymId: w.gymA.id, paymentId: cash.id, amountMinor: 2_000, reason: "Overcharged", refundedAt: new Date(), recordedById: w.staff.ownerA.id } });
  await owner.payment.create({ data: { gymId: w.gymB.id, memberId: w.memberB.id, amountMinor: 999_999, currency: "INR", method: "CASH", receivedAt: yesterdayMorning, recordedById: w.staff.ownerB.id } });
  // A member whose name is a spreadsheet formula.
  const evil = await member("evil", 90, "=HYPERLINK(\"http://evil\")");
  await owner.payment.create({ data: { gymId: w.gymA.id, memberId: evil, amountMinor: 1_000, currency: "INR", method: "TRANSFER", reference: "UPI1", receivedAt: yesterdayMorning, recordedById: w.staff.ownerA.id } });

  // ── Check-ins at 06:30 gym time (= 01:00 UTC) three days ago ──
  const day = addDays(today(), -3);
  for (let i = 0; i < 3; i++) {
    await owner.checkIn.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, locationId: locationA, method: "QR", result: "ALLOWED", checkedInAt: localDateTime(day, `06:${String(30 + i).padStart(2, "0")}`, TZ) } });
  }
  await owner.checkIn.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, locationId: locationA, method: "QR", result: "DENIED_EXPIRED", checkedInAt: localDateTime(day, "07:00", TZ) } });
  await owner.checkIn.create({ data: { gymId: w.gymB.id, memberId: w.memberB.id, locationId: locationB, method: "QR", result: "ALLOWED", checkedInAt: localDateTime(day, "06:30", TZ) } });

  // ── Retention for last month: kept, lapsed, cancelled, and joined ──
  const m = lastMonthStarts(today(), 2)[0];
  const last = monthLastDay(m);
  await membership(await member("kept", 1), addDays(m, -31), addDays(last, 60));
  await membership(await member("lapsed", 2), addDays(m, -31), addDays(m, 14));
  await membership(await member("cancelled", 3), addDays(m, -31), addDays(last, 60), { cancelledAt: localDateTime(addDays(m, 5), "12:00", TZ), status: "CANCELLED" });
  await membership(await member("joined", 4), addDays(m, 9), addDays(last, 30));

  // ── One class two days ago: 4 confirmed of 10 (2 attended, 1 no-show), plus a cancelled class ──
  const type = await owner.classType.create({ data: { gymId: w.gymA.id, name: "Yoga", color: "#22c55e", durationMinutes: 60, defaultCapacity: 10 } });
  const room = await owner.room.create({ data: { gymId: w.gymA.id, locationId: locationA, name: "Studio", capacity: 20 } });
  const startsAt = localDateTime(addDays(today(), -2), "07:00", TZ);
  const session = await owner.classSession.create({ data: { gymId: w.gymA.id, classTypeId: type.id, trainerId: w.staff.ownerA.id, roomId: room.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), capacity: 10 } });
  await owner.classSession.create({ data: { gymId: w.gymA.id, classTypeId: type.id, trainerId: w.staff.ownerA.id, roomId: room.id, startsAt: new Date(startsAt.getTime() + 7_200_000), endsAt: new Date(startsAt.getTime() + 10_800_000), capacity: 10, status: "CANCELLED" } });
  const statuses = ["ATTENDED", "ATTENDED", "NO_SHOW", "BOOKED"] as const;
  for (const [i, key] of ["kept", "lapsed", "cancelled", "joined"].entries()) {
    await owner.booking.create({ data: { gymId: w.gymA.id, sessionId: session.id, memberId: members[key], status: statuses[i] } });
  }
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("reports", () => {
  it("revenue is money received minus refunds, by method, for this gym only", async () => {
    const r = await revenueReport(ownerA, week());
    expect(r.totals).toMatchObject({ receivedMinor: 16_000, refundsMinor: 2_000, netMinor: 14_000, payments: 3 });
    expect(r.byMethod.find((m) => m.method === "CASH")).toMatchObject({ receivedMinor: 10_000, refundsMinor: 2_000 });
    expect(r.series.reduce((s, x) => s + x.netMinor, 0)).toBe(14_000);
    expect(r.series).toHaveLength(7); // every day present, gaps as zero
    expect((await revenueReport(ownerB, week())).totals.receivedMinor).toBe(999_999);
  });

  it("attendance buckets check-ins by the gym's local weekday and hour", async () => {
    const r = await attendanceReport(ownerA, week());
    const dow = (new Date(`${addDays(today(), -3)}T00:00:00Z`).getUTCDay() + 6) % 7;
    expect(r.grid[dow][6]).toBe(3); // 06:30 local, not 01:00 UTC
    expect(r.grid[dow][1]).toBe(0);
    expect(r.totals).toMatchObject({ allowed: 3, denied: 1, members: 1 });
    expect(r.byLocation).toEqual([{ name: "Main", n: 3 }]);
  });

  it("retention counts who stayed, lapsed, cancelled or joined in a month", async () => {
    const m = lastMonthStarts(today(), 2)[0];
    const r = await retentionReport(ownerA, { from: m, to: monthLastDay(m) });
    expect(r.series).toHaveLength(1);
    expect(r.series[0]).toMatchObject({ activeAtStart: 3, retained: 1, churned: 2, gained: 1, activeAtEnd: 2, retentionRate: 33.3, churnRate: 66.7 });
  });

  it("class popularity shows fill and attendance rates and counts cancelled classes", async () => {
    const [yoga] = await classReport(ownerA, week());
    expect(yoga).toMatchObject({ name: "Yoga", sessions: 1, cancelled: 1, capacity: 10, booked: 4, attended: 2, noShow: 1, fillRate: 40, attendanceRate: 66.7 });
    expect(await classReport(ownerB, week())).toEqual([]);
  });

  it("needs the reports permission and the plan feature", async () => {
    await expect(revenueReport(deskA, week())).rejects.toThrow(ForbiddenError);
    const noReports = { ...ownerA, plan: { ...ownerA.plan!, features: { ...ownerA.plan!.features, reports: false } } };
    await expect(revenueReport(noReports, week())).rejects.toThrow(FeatureNotInPlanError);
  });

  it("exports CSV with formulas neutralised, audits it, and respects the CSV feature", async () => {
    const { csv, rows, filename } = await exportReport(managerA, "revenue", week(), meta);
    expect(rows).toBe(3);
    expect(filename).toMatch(/^gym-a-revenue-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv).toContain("Alice Anand");
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"") Test"`);
    expect(csv).toContain(",100.00,20.00,80.00,"); // ₹100 cash, ₹20 refunded
    expect(csv).not.toContain("Bob Bose");
    const audit = await getOwnerDb().auditLog.findFirstOrThrow({ where: { gymId: w.gymA.id, action: "report.export" } });
    expect(audit.changes).toMatchObject({ rows: 3 });
    expect(JSON.stringify(audit.changes)).not.toContain("Alice");

    const noCsv = { ...managerA, plan: { ...managerA.plan!, features: { ...managerA.plan!.features, csvExport: false } } };
    await expect(exportReport(noCsv, "classes", week(), meta)).rejects.toThrow(FeatureNotInPlanError);
    for (const kind of ["attendance", "retention", "classes"] as const) {
      expect((await exportReport(ownerA, kind, week(), meta)).csv.split("\r\n")[0]).toContain(",");
    }
  });
});

describe("notifications", () => {
  let expiringId: string;
  let overdueId: string;

  beforeAll(async () => {
    const owner = getOwnerDb();
    expiringId = (await membership(await member("expiring", 10), addDays(today(), -27), addDays(today(), 3))).id;
    // Ends soon too, but already renewed → no alert.
    const renewedMember = await member("renewed", 11);
    const renewed = await membership(renewedMember, addDays(today(), -27), addDays(today(), 3));
    await membership(renewedMember, addDays(today(), 4), addDays(today(), 33));
    const inv = await owner.invoice.create({
      data: { gymId: w.gymA.id, number: 1, memberId: w.memberA.id, currency: "INR", subtotalMinor: 1000, taxMinor: 0, totalMinor: 1000, issuedAt: new Date(), dueDate: fromDateString(addDays(today(), -5)) },
    });
    overdueId = inv.id;
    expect(renewed.id).toBeTruthy();
    await refreshNotifications(ownerA, { force: true });
  });

  it("alerts the right people: expiring memberships to front desk too, overdue payments to managers and owners", async () => {
    const db = getOwnerDb();
    const forEntity = (entityId: string) => db.notification.findMany({ where: { entityId }, select: { recipientUserId: true } });
    const expiringTo = (await forEntity(expiringId)).map((n) => n.recipientUserId).sort();
    expect(expiringTo).toEqual([w.users.ownerA.id, w.users.deskA.id, managerA.user.id].sort());
    const overdueTo = (await forEntity(overdueId)).map((n) => n.recipientUserId).sort();
    expect(overdueTo).toEqual([w.users.ownerA.id, managerA.user.id].sort());
    expect(overdueTo).not.toContain(w.users.removedA.id);
    // The renewed membership raised nothing.
    const renewedIds = (await db.membership.findMany({ where: { memberId: members.renewed }, select: { id: true } })).map((m) => m.id);
    expect(await db.notification.count({ where: { entityId: { in: renewedIds } } })).toBe(0);
    const n = await db.notification.findFirstOrThrow({ where: { entityId: overdueId } });
    expect(n.body).toBe("Invoice INV-000001 for Alice Anand is 5 days overdue.");
  });

  it("is idempotent: refreshing again creates no duplicates", async () => {
    const before = await getOwnerDb().notification.count({ where: { gymId: w.gymA.id } });
    await refreshNotifications(ownerA, { force: true });
    await refreshNotifications(deskA, { force: true }); // any staff member may trigger it
    expect(await getOwnerDb().notification.count({ where: { gymId: w.gymA.id } })).toBe(before);
  });

  it("each person sees and updates only their own notifications, even with direct queries", async () => {
    const mine = await listNotifications(deskA, { unreadOnly: false, page: 1 });
    expect(mine.rows.map((r) => r.type)).toEqual(["MEMBERSHIP_EXPIRING"]);
    const raw = await inTenant(deskA, (tx) => tx.notification.findMany({ select: { recipientUserId: true } }));
    expect(raw.every((r) => r.recipientUserId === w.users.deskA.id)).toBe(true);

    const ownersAlert = await getOwnerDb().notification.findFirstOrThrow({ where: { recipientUserId: w.users.ownerA.id, entityId: overdueId } });
    expect(await markNotificationRead(deskA, ownersAlert.id)).toBeNull();
    const sneaky = await inTenant(deskA, (tx) => tx.notification.updateMany({ where: { id: ownersAlert.id }, data: { readAt: new Date() } }));
    expect(sneaky.count).toBe(0);
    expect(await listNotifications(ownerB, { unreadOnly: false, page: 1 })).toMatchObject({ total: 0 });
  });

  it("opening a notification marks it read and links to what it's about; content can't be edited", async () => {
    const n = await getOwnerDb().notification.findFirstOrThrow({ where: { recipientUserId: w.users.ownerA.id, entityId: overdueId } });
    const before = await unreadNotificationCount(ownerA);
    expect(await markNotificationRead(ownerA, n.id)).toEqual({ href: `/g/gym-a/invoices/${overdueId}` });
    expect(await unreadNotificationCount(ownerA)).toBe(before - 1);
    await expect(inTenant(ownerA, (tx) => tx.notification.updateMany({ where: { id: n.id }, data: { body: "Edited" } }))).rejects.toThrow();
    const exp = await getOwnerDb().notification.findFirstOrThrow({ where: { recipientUserId: w.users.deskA.id, entityId: expiringId } });
    expect((await markNotificationRead(deskA, exp.id))?.href).toBe(`/g/gym-a/members/${members.expiring}`);
  });

  it("mark all as read clears only my unread count", async () => {
    expect((await markAllNotificationsRead(ownerA)).marked).toBeGreaterThan(0);
    expect(await unreadNotificationCount(ownerA)).toBe(0);
    expect(await unreadNotificationCount(managerA)).toBeGreaterThan(0);
  });
});

describe("settings", () => {
  const profile = (over: Record<string, unknown> = {}) => ({ name: "Gym A", email: null, phone: null, address: null, timezone: TZ, currency: "INR", taxRate: 1800, ...over }) as never;

  it("the owner updates the profile; the change is audited with a diff", async () => {
    expect(await updateGymProfile(ownerA, profile({ taxRate: 1250, address: "1 MG Road" }), meta)).toEqual({ changed: 2 });
    expect(await getOwnerDb().gym.findUniqueOrThrow({ where: { id: w.gymA.id } })).toMatchObject({ taxRateBps: 1250, address: "1 MG Road" });
    const entry = await getOwnerDb().auditLog.findFirstOrThrow({ where: { gymId: w.gymA.id, action: "settings.update" } });
    expect(entry.changes).toMatchObject({ taxRateBps: { from: 1800, to: 1250 } });
    expect(await updateGymProfile(ownerA, profile({ taxRate: 1250, address: "1 MG Road" }), meta)).toEqual({ changed: 0 });
  });

  it("managers and front desk can't change settings, and the database refuses it too", async () => {
    await expect(updateGymProfile(managerA, profile({ name: "Hacked" }), meta)).rejects.toThrow(ForbiddenError);
    await expect(getSettings(deskA)).rejects.toThrow(ForbiddenError);
    const r = await inTenant(managerA, (tx) => tx.gym.updateMany({ where: { id: w.gymA.id }, data: { name: "Hacked" } }));
    expect(r.count).toBe(0);
    const cross = await inTenant(ownerA, (tx) => tx.gym.updateMany({ where: { id: w.gymB.id }, data: { name: "Hacked" } }));
    expect(cross.count).toBe(0);
  });

  it("the currency is locked once money has been recorded", async () => {
    expect((await getSettings(ownerA)).currencyLocked).toBe(true);
    await expect(updateGymProfile(ownerA, profile({ currency: "USD", taxRate: 1250, address: "1 MG Road" }), meta)).rejects.toThrow(ValidationError);
    const empty = await resolveTenant(u(w.users.ownerB), "gym-b");
    await getOwnerDb().payment.deleteMany({ where: { gymId: w.gymB.id } });
    expect(await updateGymProfile(empty!, profile({ name: "Gym B", currency: "USD" }), meta)).toEqual({ changed: 1 });
  });

  it("opening hours: only this gym's locations; locations respect the plan limit", async () => {
    const days = Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, isClosed: d === 0, openMinute: 330, closeMinute: 1320 }));
    await saveOpeningHours(ownerA, { locationId: locationA, days }, meta);
    expect(await getOwnerDb().openingHours.count({ where: { locationId: locationA, isClosed: true } })).toBe(1);
    await expect(saveOpeningHours(ownerA, { locationId: locationB, days }, meta)).rejects.toThrow(NotFoundError);

    await saveLocation(ownerA, { name: "Second", address: null }, meta); // limit is 2
    await expect(saveLocation(ownerA, { name: "Third", address: null }, meta)).rejects.toThrow(PlanLimitError);
    expect((await getSettings(ownerA)).locations.find((l) => l.name === "Second")?.openingHours).toHaveLength(7);
  });

  it("logo uploads are checked by content and visible to all of this gym's staff only", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001", "hex");
    await expect(setGymLogo(ownerA, Buffer.from("<svg onload=alert(1)>"), meta)).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(setGymLogo(managerA, png, meta)).rejects.toThrow(ForbiddenError);
    await setGymLogo(ownerA, png, meta);
    const { logoFileId } = await getOwnerDb().gym.findUniqueOrThrow({ where: { id: w.gymA.id } });
    expect((await readGymFile(deskA, logoFileId!))?.mimeType).toBe("image/png");
    expect(await readGymFile(ownerB, logoFileId!)).toBeNull();
    // A gym can't point its logo at another gym's file, even as the database owner.
    await expect(getOwnerDb().gym.update({ where: { id: w.gymB.id }, data: { logoFileId } })).rejects.toThrow(/logo file does not belong/);
  });
});

describe("audit log", () => {
  it("owners see their gym's trail, filterable; nobody else does", async () => {
    const settings = await listAuditLog(ownerA, { category: "settings", page: 1 });
    expect(settings.rows.length).toBeGreaterThan(0);
    expect(settings.rows.every((r) => r.action.startsWith("settings.") || r.action.startsWith("location."))).toBe(true);
    expect(settings.rows[0].actor.name).toBe(w.users.ownerA.name);

    const all = await listAuditLog(ownerA, { page: 1 });
    expect(all.rows.some((r) => r.action === "test.event")).toBe(false); // gym B's fixture entry
    const byManager = await listAuditLog(ownerA, { actorUserId: managerA.user.id, page: 1 });
    expect(byManager.rows.map((r) => r.action)).toEqual(["report.export"]);
    expect(all.people.some((p) => p.userId === w.users.removedA.id && p.removed)).toBe(true);

    await expect(listAuditLog(managerA, { page: 1 })).rejects.toThrow(ForbiddenError);
    expect((await listAuditLog(ownerB, { page: 1 })).rows.map((r) => r.action)).toContain("test.event");
  });
});
