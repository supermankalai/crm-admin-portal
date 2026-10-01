import type { Prisma } from "@/generated/prisma/client";
import { invoiceTotals } from "@/domain/money";
import { encryptField, encryptJson, phoneBlindIndex } from "@/server/crypto";
import type { DbClient } from "@/server/db/create-client";
import type { GymSpec } from "./config";
import { at, chance, dateOnly, faker, id, insertMany, int, localDay, NOW, past, pick, sample, weighted } from "./lib";

type Role = "OWNER" | "MANAGER" | "FRONT_DESK" | "TRAINER";
type Staff = { id: string; userId: string; role: Role; email: string; name: string };
type PlanRow = Prisma.MembershipPlanCreateManyInput & { id: string; durationDays: number; priceMinor: number };

export type SeededLogin = { email: string; gym: string; role: Role };

const TAX_BPS = 1800;
const PAYMENT_HISTORY_DAYS = 183;

const ROLE_EMAIL: Record<Role, string> = { OWNER: "owner", MANAGER: "manager", FRONT_DESK: "frontdesk", TRAINER: "trainer" };

// Check-in volume by local hour: early-morning and after-work peaks.
const HOUR_WEIGHTS: [number, number][] = [
  [5, 2], [6, 8], [7, 10], [8, 7], [9, 4], [10, 3], [11, 2], [12, 3], [13, 3],
  [14, 2], [15, 2], [16, 4], [17, 8], [18, 10], [19, 9], [20, 6], [21, 3],
];
const SUNDAY_HOUR_WEIGHTS: [number, number][] = [[7, 6], [8, 9], [9, 8], [10, 6], [11, 4], [12, 2]];

export async function seedGym(
  db: DbClient,
  spec: GymSpec,
  ctx: { planIds: Record<string, string>; staffPasswordHash: string; sharedUserId: string; superAdminId: string }
): Promise<SeededLogin[]> {
  console.log(`  ${spec.name} (/g/${spec.slug})`);
  const gymId = id();
  const logins: SeededLogin[] = [];

  // ── Gym + platform subscription ──────────────────────────────────────────
  await db.gym.create({
    data: {
      id: gymId,
      slug: spec.slug,
      name: spec.name,
      status: spec.status,
      timezone: "Asia/Kolkata",
      currency: "INR",
      taxRateBps: TAX_BPS,
      brandColor: spec.brandColor,
      email: `hello@${spec.emailDomain}`,
      phone: `+91 80 ${int(2000, 4999)} ${int(1000, 9999)}`,
      address: `${faker.location.streetAddress()}, ${spec.locations[0]}, Bengaluru`,
      createdAt: at(-spec.createdDaysAgo, 9),
    },
  });

  const isTrial = spec.status === "TRIAL";
  const periodEnd = at(spec.periodEndsInDays, 23, 59);
  const periodStart = isTrial ? at(-spec.createdDaysAgo, 9) : at(spec.periodEndsInDays - 30, 0);
  await db.gymSubscription.create({
    data: {
      gymId,
      planId: ctx.planIds[spec.planCode],
      status: isTrial ? "TRIALING" : "ACTIVE",
      trialEndsAt: isTrial ? periodEnd : at(-spec.createdDaysAgo + 14, 9),
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      provider: "MANUAL",
    },
  });

  const history: Prisma.SubscriptionHistoryCreateManyInput[] = [
    {
      gymId,
      action: "TRIAL_STARTED",
      toPlanId: ctx.planIds[isTrial ? spec.planCode : "STARTER"],
      toStatus: "TRIALING",
      newPeriodEnd: at(-spec.createdDaysAgo + 14, 9),
      note: "Self-service sign-up",
      createdAt: at(-spec.createdDaysAgo, 9),
    },
  ];
  if (!isTrial) {
    history.push({
      gymId,
      action: "ACTIVATED",
      fromPlanId: ctx.planIds.STARTER,
      toPlanId: ctx.planIds.STARTER,
      fromStatus: "TRIALING",
      toStatus: "ACTIVE",
      newPeriodEnd: at(-spec.createdDaysAgo + 44, 23, 59),
      actorUserId: ctx.superAdminId,
      note: "Manual activation after bank transfer",
      createdAt: at(-spec.createdDaysAgo + 14, 11),
    });
    if (spec.planCode !== "STARTER") {
      history.push({
        gymId,
        action: "PLAN_CHANGED",
        fromPlanId: ctx.planIds.STARTER,
        toPlanId: ctx.planIds[spec.planCode],
        fromStatus: "ACTIVE",
        toStatus: "ACTIVE",
        actorUserId: ctx.superAdminId,
        note: "Upgraded on request",
        createdAt: at(-Math.floor(spec.createdDaysAgo / 2), 15),
      });
    }
    history.push({
      gymId,
      action: "EXTENDED",
      fromPlanId: ctx.planIds[spec.planCode],
      toPlanId: ctx.planIds[spec.planCode],
      fromStatus: "ACTIVE",
      toStatus: "ACTIVE",
      previousPeriodEnd: at(spec.periodEndsInDays - 30, 0),
      newPeriodEnd: periodEnd,
      actorUserId: ctx.superAdminId,
      note: "Monthly renewal",
      createdAt: at(spec.periodEndsInDays - 30, 10),
    });
  }
  await db.subscriptionHistory.createMany({ data: history });

  // ── Locations, opening hours, rooms ──────────────────────────────────────
  const locations = spec.locations.map((name) => ({ id: id(), gymId, name, address: `${faker.location.streetAddress()}, ${name}, Bengaluru` }));
  await db.location.createMany({ data: locations });
  await db.openingHours.createMany({
    data: locations.flatMap((loc) =>
      Array.from({ length: 7 }, (_, dow) => ({
        gymId,
        locationId: loc.id,
        dayOfWeek: dow,
        openMinute: dow === 0 ? 7 * 60 : 5 * 60 + 30,
        closeMinute: dow === 0 ? 13 * 60 : 22 * 60,
      }))
    ),
  });
  const rooms = locations.flatMap((loc) =>
    [
      ["Studio A", 20],
      ["Studio B", 15],
      ["Spin Room", 12],
    ].map(([name, capacity]) => ({ id: id(), gymId, locationId: loc.id, name: name as string, capacity: capacity as number }))
  );
  await db.room.createMany({ data: rooms });

  // ── Staff (users are global; StaffMember is the per-gym role) ─────────────
  const staff: Staff[] = [];
  const users: Prisma.UserCreateManyInput[] = [];
  const addStaff = (role: Role, index: number, shared = false) => {
    const staffId = id();
    if (shared) {
      staff.push({ id: staffId, userId: ctx.sharedUserId, role, email: "priya.nair@fitcrm.example", name: "Priya Nair" });
      return;
    }
    const name = faker.person.fullName();
    const suffix = role === "OWNER" ? "" : String(index);
    const email = `${ROLE_EMAIL[role]}${suffix}@${spec.emailDomain}`;
    const userId = id();
    users.push({ id: userId, email, name, passwordHash: ctx.staffPasswordHash, createdAt: at(-spec.createdDaysAgo, 9), lastLoginAt: past(at(-int(0, 3), int(7, 20))) });
    staff.push({ id: staffId, userId, role, email, name });
  };
  addStaff("OWNER", 1);
  const counts: Record<Exclude<Role, "OWNER">, number> = { MANAGER: spec.managers, FRONT_DESK: spec.frontDesk, TRAINER: spec.trainers };
  for (const role of ["MANAGER", "FRONT_DESK", "TRAINER"] as const) {
    let n = counts[role];
    if (spec.sharedUserRole === role) {
      addStaff(role, 0, true);
      n -= 1;
    }
    for (let i = 1; i <= n; i++) addStaff(role, i);
  }
  await db.user.createMany({ data: users });

  const SPECIALTIES = ["Strength", "HIIT", "Yoga", "Mobility", "Spin", "Pilates", "Nutrition", "Boxing", "Zumba"];
  await db.staffMember.createMany({
    data: staff.map((s) => ({
      id: s.id,
      gymId,
      userId: s.userId,
      role: s.role,
      title: { OWNER: "Owner", MANAGER: "Gym Manager", FRONT_DESK: "Front Desk", TRAINER: "Personal Trainer" }[s.role],
      bio: s.role === "TRAINER" ? faker.lorem.sentence({ min: 10, max: 18 }) : null,
      specialties: s.role === "TRAINER" ? sample(SPECIALTIES, int(2, 3)) : [],
      phoneEnc: encryptField(`+91 9${int(100000000, 999999999)}`, { gymId, model: "StaffMember", field: "phone", recordId: s.id }),
      notesEnc: chance(0.4)
        ? encryptField(pick(["Prefers morning shifts.", "Certified in CPR (renew next year).", "Covering weekend classes this month.", "Completed nutrition certification."]), { gymId, model: "StaffMember", field: "notes", recordId: s.id })
        : null,
      createdAt: at(-spec.createdDaysAgo + int(0, 30), 10),
    })),
  });
  for (const s of staff) logins.push({ email: s.email, gym: spec.slug, role: s.role });

  const byRole = (role: Role) => staff.filter((s) => s.role === role);
  const trainers = byRole("TRAINER");
  const deskStaff = [...byRole("FRONT_DESK"), ...byRole("MANAGER")];
  const alertRecipients = staff.filter((s) => s.role !== "TRAINER");

  // ── Membership plans ─────────────────────────────────────────────────────
  const price = (rupees: number) => Math.round((rupees * spec.priceFactor) / 50) * 50 * 100;
  const planDefs: Omit<PlanRow, "gymId" | "id">[] = [
    { name: "Monthly Standard", type: "MONTHLY", priceMinor: price(2500), durationDays: 30, allowFreeze: false, cancellationNoticeDays: 0 },
    { name: "Monthly Off-Peak", type: "MONTHLY", priceMinor: price(1800), durationDays: 30, description: "Access 10:00–16:00 on weekdays." },
    { name: "Quarterly", type: "QUARTERLY", priceMinor: price(6750), durationDays: 90, allowFreeze: true, maxFreezeDays: 14, cancellationNoticeDays: 7, cancellationFeeMinor: price(500) },
    { name: "Annual", type: "YEARLY", priceMinor: price(24000), durationDays: 365, allowFreeze: true, maxFreezeDays: 30, cancellationNoticeDays: 30, cancellationFeeMinor: price(2000) },
    { name: "10-Class Pack", type: "CLASS_PACK", priceMinor: price(3000), durationDays: 60, classCredits: 10 },
  ];
  if (spec.key === "iron") {
    planDefs.push({ name: "20-Class Pack", type: "CLASS_PACK", priceMinor: price(5500), durationDays: 90, classCredits: 20, allowFreeze: true, maxFreezeDays: 14 });
  }
  const plans: PlanRow[] = planDefs.map((p) => ({ ...p, id: id(), gymId, createdAt: at(-spec.createdDaysAgo + 1, 10) }));
  await db.membershipPlan.createMany({ data: plans });
  const freezablePlans = plans.filter((p) => p.allowFreeze);

  // ── Members ──────────────────────────────────────────────────────────────
  type MemberSeed = {
    id: string;
    joined: number;
    target: "active" | "expired" | "frozen";
    locationId: string;
    visitRate: number;
    memberNumber: number;
  };
  const members: MemberSeed[] = [];
  const memberRows: Prisma.MemberCreateManyInput[] = [];
  const usedCodes = new Set<string>();
  for (let i = 0; i < spec.memberCount; i++) {
    const memberId = id();
    const sex = pick(["female", "male"] as const);
    const firstName = faker.person.firstName(sex);
    const lastName = faker.person.lastName();
    const joined = -int(10, 540);
    const phone = `+91 ${pick(["9", "8", "7"])}${int(100000000, 999999999)}`;
    const enc = (field: string, value: string) => encryptField(value, { gymId, model: "Member", field, recordId: memberId });
    let code: string;
    do code = faker.string.alphanumeric({ length: 10, casing: "upper" });
    while (usedCodes.has(code));
    usedCodes.add(code);

    const dob = faker.date.birthdate({ mode: "age", min: 18, max: 64 }).toISOString().slice(0, 10);
    members.push({
      id: memberId,
      joined,
      target: weighted([["active", 65], ["expired", 25], ["frozen", 10]] as const),
      locationId: pick(locations).id,
      visitRate: faker.number.float({ min: 0.08, max: 0.6 }),
      memberNumber: 0,
    });
    memberRows.push({
      id: memberId,
      gymId,
      memberNumber: 0,
      firstName,
      lastName,
      email: chance(0.88) ? `${firstName}.${lastName}${i}@example.com`.toLowerCase().replace(/[^a-z0-9.@]/g, "") : null,
      phoneEnc: enc("phone", phone),
      phoneBlindIndex: phoneBlindIndex(gymId, phone),
      addressEnc: enc("address", `${faker.location.streetAddress()}, ${faker.location.city()} ${faker.location.zipCode()}`),
      dateOfBirthEnc: enc("dateOfBirth", dob),
      emergencyContactEnc: encryptJson(
        { name: faker.person.fullName(), phone: `+91 9${int(100000000, 999999999)}`, relation: pick(["Spouse", "Parent", "Sibling", "Friend"]) },
        { gymId, model: "Member", field: "emergencyContact", recordId: memberId }
      ),
      healthNotesEnc: chance(0.3)
        ? enc("healthNotes", pick(["Mild asthma — carries inhaler.", "Recovering from knee surgery; avoid deep squats.", "Lower back pain; no heavy deadlifts.", "Type 2 diabetes, well controlled.", "High blood pressure, on medication."]))
        : null,
      checkInCode: code,
      joinedAt: at(joined, int(7, 20), int(0, 59)),
      createdAt: at(joined, int(7, 20)),
    });
  }
  // ── Memberships, freezes, invoices, payments, refunds ─────────────────────
  type MembershipSeed = Prisma.MembershipCreateManyInput & { id: string; start: number; end: number; memberSeed: MemberSeed; freeze?: [number, number] };
  const memberships: MembershipSeed[] = [];
  const freezes: Prisma.MembershipFreezeCreateManyInput[] = [];
  for (const m of members) {
    const isPackOk = chance(0.15);
    const plan =
      m.target === "frozen"
        ? pick(freezablePlans)
        : pick(plans.filter((p) => (isPackOk ? p.type === "CLASS_PACK" : p.type !== "CLASS_PACK")));
    const chain: { plan: PlanRow; start: number; end: number }[] = [];
    let start: number;
    let end: number;
    if (m.target === "expired") {
      end = -int(1, 75);
      start = end - plan.durationDays + 1;
      if (start < m.joined) m.joined = start;
    } else {
      start = Math.max(-int(0, plan.durationDays - 1), m.joined);
      end = start + plan.durationDays - 1;
    }
    chain.push({ plan, start, end });
    // Earlier renewals back to the start of the payment history (or the join date).
    let prevEnd = start - 1 - (chance(0.7) ? 0 : int(1, 20));
    while (chance(0.75)) {
      const prevPlan = chance(0.8) ? plan : pick(plans);
      const prevStart = prevEnd - prevPlan.durationDays + 1;
      if (prevStart < Math.max(m.joined, -PAYMENT_HISTORY_DAYS)) break;
      chain.unshift({ plan: prevPlan, start: prevStart, end: prevEnd });
      prevEnd = prevStart - 1 - (chance(0.7) ? 0 : int(1, 20));
    }
    // Keep the stored join date consistent with the earliest membership.
    m.joined = Math.min(m.joined, chain[0].start);
    const row = memberRows.find((r) => r.id === m.id)!;
    row.joinedAt = at(m.joined, int(7, 20), int(0, 59));
    row.createdAt = row.joinedAt;

    chain.forEach((c, index) => {
      const isLast = index === chain.length - 1;
      const membershipId = id();
      let status: "ACTIVE" | "FROZEN" | "EXPIRED" | "CANCELLED" = c.end < 0 ? "EXPIRED" : "ACTIVE";
      let freeze: [number, number] | undefined;
      if (isLast && m.target === "frozen") {
        status = "FROZEN";
        freeze = [-int(1, 10), int(3, 12)];
        freezes.push({ gymId, membershipId, startDate: dateOnly(freeze[0]), endDate: dateOnly(freeze[1]), reason: pick(["Travel", "Injury recovery", "Work assignment abroad", "Exams"]), createdAt: at(freeze[0], 10) });
      }
      const cancelled = isLast && m.target === "expired" && chance(0.15);
      if (cancelled) status = "CANCELLED";
      memberships.push({
        id: membershipId,
        gymId,
        memberId: m.id,
        planId: c.plan.id,
        status,
        startDate: dateOnly(c.start),
        endDate: dateOnly(c.end),
        priceMinor: c.plan.priceMinor,
        classCreditsRemaining: c.plan.classCredits ? (status === "ACTIVE" || status === "FROZEN" ? int(0, c.plan.classCredits) : 0) : null,
        cancelledAt: cancelled ? at(c.end - int(5, 20), 12) : null,
        cancelReason: cancelled ? pick(["Moving to another city", "Too expensive", "Health reasons", "Not using it enough"]) : null,
        createdAt: past(at(c.start, 10)),
        start: c.start,
        end: c.end,
        memberSeed: m,
        freeze,
      });
    });
  }
  // Member numbers follow join order, like a real gym.
  const order = memberRows.map((row, i) => ({ row, seed: members[i] })).sort((a, b) => a.seed.joined - b.seed.joined);
  order.forEach(({ row, seed }, i) => {
    row.memberNumber = i + 1;
    seed.memberNumber = i + 1;
  });
  await insertMany("members", memberRows, (chunk) => db.member.createMany({ data: chunk }));
  await insertMany("memberships", memberships, (chunk) =>
    db.membership.createMany({ data: chunk.map(({ start: _s, end: _e, memberSeed: _m, freeze: _f, ...row }) => row) })
  );
  await insertMany("membership freezes", freezes, (chunk) => db.membershipFreeze.createMany({ data: chunk }));

  type InvoiceSeed = Prisma.InvoiceCreateManyInput & { id: string; issuedAt: Date };
  const invoices: InvoiceSeed[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const refunds: Prisma.RefundCreateManyInput[] = [];
  const overdueInvoiceIds: string[] = [];
  for (const ms of memberships) {
    if (ms.start < -PAYMENT_HISTORY_DAYS) continue;
    const invoiceId = id();
    const totals = invoiceTotals(ms.priceMinor, TAX_BPS);
    const issuedAt = past(at(ms.start, int(8, 19), int(0, 59)));
    const dueOffset = ms.start + 7;
    const isLatest = ms.end >= 0 || ms.status === "CANCELLED";
    const overdue = isLatest && ms.status === "ACTIVE" && dueOffset < 0 && chance(0.08);
    const pendingNotDue = isLatest && ms.status === "ACTIVE" && dueOffset >= 0 && chance(0.12);
    const recorder = pick(deskStaff);
    const method = weighted([["CARD", 45], ["CASH", 25], ["TRANSFER", 30]] as const);

    if (overdue || pendingNotDue) {
      const partial = overdue && chance(0.3) ? Math.floor(totals.totalMinor / 2) : 0;
      invoices.push({ id: invoiceId, gymId, number: 0, memberId: ms.memberId, membershipId: ms.id, status: "OPEN", currency: "INR", ...totals, amountPaidMinor: partial, issuedAt, dueDate: dateOnly(dueOffset), createdAt: issuedAt });
      if (overdue) overdueInvoiceIds.push(invoiceId);
      if (partial) {
        payments.push({ id: id(), gymId, memberId: ms.memberId, invoiceId, amountMinor: partial, currency: "INR", method, receivedAt: past(new Date(issuedAt.getTime() + 5 * 60_000)), recordedById: recorder.id, reference: method === "TRANSFER" ? `UTR${int(100000000, 999999999)}` : null, createdAt: issuedAt });
      }
      continue;
    }

    const receivedAt = past(new Date(issuedAt.getTime() + int(2, 30) * 60_000));
    invoices.push({ id: invoiceId, gymId, number: 0, memberId: ms.memberId, membershipId: ms.id, status: "PAID", currency: "INR", ...totals, amountPaidMinor: totals.totalMinor, issuedAt, dueDate: dateOnly(dueOffset), paidAt: receivedAt, createdAt: issuedAt });
    const paymentId = id();
    const refundRoll = faker.number.float({ min: 0, max: 1 });
    const fullRefund = ms.status === "CANCELLED" || refundRoll < 0.02;
    const partialRefund = !fullRefund && refundRoll < 0.035;
    payments.push({
      id: paymentId,
      gymId,
      memberId: ms.memberId,
      invoiceId,
      amountMinor: totals.totalMinor,
      currency: "INR",
      method,
      status: fullRefund ? "REFUNDED" : partialRefund ? "PARTIALLY_REFUNDED" : "COMPLETED",
      reference: method === "TRANSFER" ? `UTR${int(100000000, 999999999)}` : method === "CARD" ? `POS-${int(10000, 99999)}` : null,
      receivedAt,
      recordedById: recorder.id,
      createdAt: receivedAt,
    });
    if (fullRefund || partialRefund) {
      const refundedAt = new Date(Math.min(receivedAt.getTime() + int(1, 10) * 86_400_000, NOW.getTime() - 3_600_000));
      refunds.push({
        gymId,
        paymentId,
        amountMinor: fullRefund ? totals.totalMinor : Math.floor(totals.totalMinor * 0.3),
        reason: fullRefund ? "Membership cancelled within cooling-off period" : "Goodwill credit for facility closure",
        refundedAt,
        recordedById: pick(byRole("MANAGER")).id,
        createdAt: refundedAt,
      });
    }
  }
  invoices.sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime()).forEach((inv, i) => (inv.number = i + 1));
  await insertMany("invoices", invoices, (chunk) => db.invoice.createMany({ data: chunk }));
  await insertMany("payments", payments, (chunk) => db.payment.createMany({ data: chunk }));
  await insertMany("refunds", refunds, (chunk) => db.refund.createMany({ data: chunk }));

  // ── Check-ins (6 months, realistic busy hours, plus denied attempts) ─────
  const currentLocalHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(NOW));
  const checkIns: Prisma.CheckInCreateManyInput[] = [];
  const checkInMethod = () => weighted([["QR", 50], ["MEMBER_ID", 20], ["NAME_SEARCH", 30]] as const);
  for (const ms of memberships) {
    const m = ms.memberSeed;
    const from = Math.max(ms.start, -PAYMENT_HISTORY_DAYS);
    const to = Math.min(ms.end, 0);
    for (let day = from; day <= to; day++) {
      if (ms.freeze && day >= ms.freeze[0] && day <= ms.freeze[1]) continue;
      if (ms.cancelledAt && at(day, 0) > ms.cancelledAt) break;
      const sunday = localDay(day).dow === 0;
      if (!chance(sunday ? m.visitRate * 0.5 : m.visitRate)) continue;
      const hour = weighted(sunday ? SUNDAY_HOUR_WEIGHTS : HOUR_WEIGHTS);
      if (day === 0 && hour >= currentLocalHour) continue;
      const method = checkInMethod();
      checkIns.push({ gymId, memberId: m.id, locationId: m.locationId, method, result: "ALLOWED", checkedInAt: at(day, hour, int(0, 59)), recordedById: method === "QR" ? null : pick(deskStaff).id });
    }
  }
  for (const m of members) {
    const last = memberships.filter((ms) => ms.memberId === m.id).at(-1)!;
    if (m.target === "expired" && chance(0.4)) {
      const day = Math.min(last.end + int(1, 10), 0);
      checkIns.push({ gymId, memberId: m.id, locationId: m.locationId, method: "MEMBER_ID", result: "DENIED_EXPIRED", checkedInAt: at(day, pick([7, 18]), int(0, 59)), recordedById: pick(deskStaff).id });
    }
    if (m.target === "frozen" && last.freeze && chance(0.3)) {
      checkIns.push({ gymId, memberId: m.id, locationId: m.locationId, method: "QR", result: "DENIED_FROZEN", checkedInAt: at(last.freeze[0], 18, int(0, 59)) });
    }
  }
  // Nothing in the future (the seed can run at any time of day).
  const pastCheckIns = checkIns.filter((c) => (c.checkedInAt as Date) <= NOW);
  pastCheckIns.forEach((c) => (c.createdAt = c.checkedInAt));
  await insertMany("check-ins", pastCheckIns, (chunk) => db.checkIn.createMany({ data: chunk }), 2000);

  // ── Trainer clients + staff notes on members ──────────────────────────────
  const activeMembers = members.filter((m) => m.target !== "expired");
  const trainerClients: Prisma.TrainerClientCreateManyInput[] = [];
  const assigned = new Set<string>();
  for (const trainer of trainers) {
    for (const m of sample(activeMembers, int(5, 12))) {
      const key = `${trainer.id}:${m.id}`;
      if (assigned.has(key)) continue;
      assigned.add(key);
      trainerClients.push({ gymId, trainerId: trainer.id, memberId: m.id, createdAt: at(Math.max(m.joined, -120), 11) });
    }
  }
  await insertMany("trainer clients", trainerClients, (chunk) => db.trainerClient.createMany({ data: chunk }));

  const NOTE_TEXT = [
    "Wants to train for a half marathon in March.",
    "Asked about upgrading to the annual plan.",
    "Prefers female trainers for PT sessions.",
    "Shoulder discomfort reported during overhead press — refer to physio.",
    "Interested in the nutrition consultation.",
    "Paid by company — invoice in company name.",
  ];
  const notes: Prisma.MemberNoteCreateManyInput[] = [];
  for (const m of sample(members, Math.round(members.length * 0.2))) {
    for (let n = 0; n < int(1, 3); n++) {
      const noteId = id();
      const author = pick([...trainers, ...byRole("MANAGER")]);
      const created = past(at(-int(0, 120), int(8, 20)));
      notes.push({ id: noteId, gymId, memberId: m.id, authorId: author.id, bodyEnc: encryptField(pick(NOTE_TEXT), { gymId, model: "MemberNote", field: "body", recordId: noteId }), createdAt: created });
    }
  }
  await insertMany("member notes", notes, (chunk) => db.memberNote.createMany({ data: chunk }));

  // ── Classes (4 weeks: 2 past, 2 upcoming), bookings and waitlists ─────────
  const classTypes = [
    { name: "Power Yoga", color: "#22c55e", durationMinutes: 60, defaultCapacity: 18 },
    { name: "HIIT Blast", color: "#ef4444", durationMinutes: 45, defaultCapacity: 15 },
    { name: "Spin Express", color: "#3b82f6", durationMinutes: 45, defaultCapacity: 12 },
    { name: "Strength Circuit", color: "#f59e0b", durationMinutes: 60, defaultCapacity: 14 },
    { name: "Zumba", color: "#ec4899", durationMinutes: 60, defaultCapacity: 20 },
    { name: "Core & Mobility", color: "#8b5cf6", durationMinutes: 30, defaultCapacity: 16 },
  ].map((t) => ({ ...t, id: id(), gymId, description: faker.lorem.sentence({ min: 8, max: 14 }) }));
  await db.classType.createMany({ data: classTypes });

  const weekStart = -((localDay(0).dow + 6) % 7) - 14; // Monday two weeks ago
  const sessions: (Prisma.ClassSessionCreateManyInput & { id: string; day: number; capacity: number; startsAt: Date })[] = [];
  for (let day = weekStart; day < weekStart + 28; day++) {
    const sunday = localDay(day).dow === 0;
    const slots: [number, number][] = sunday ? [[8, 0], [10, 0]] : [[7, 0], [12, 30], [18, 0], [19, 30]];
    for (const location of locations) {
      for (const [hour, minute] of slots) {
        const type = pick(classTypes);
        const room = type.name === "Spin Express" ? rooms.find((r) => r.locationId === location.id && r.name === "Spin Room")! : pick(rooms.filter((r) => r.locationId === location.id && r.name !== "Spin Room"));
        const startsAt = at(day, hour, minute);
        sessions.push({
          id: id(),
          gymId,
          classTypeId: type.id,
          trainerId: pick(trainers).id,
          roomId: room.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + type.durationMinutes * 60_000),
          capacity: Math.min(type.defaultCapacity, room.capacity),
          status: startsAt < NOW ? "COMPLETED" : "SCHEDULED",
          day,
          createdAt: at(weekStart - 7, 10),
        });
      }
    }
  }
  const future = sessions.filter((s) => s.status === "SCHEDULED");
  if (future.length > 3) future[3].status = "CANCELLED";
  await insertMany("class sessions", sessions, (chunk) => db.classSession.createMany({ data: chunk.map(({ day: _d, ...row }) => row) }));

  const bookable = members.filter((m) => m.target === "active");
  const bookings: Prisma.BookingCreateManyInput[] = [];
  for (const session of sessions) {
    if (session.status === "CANCELLED") continue;
    const isPast = session.status === "COMPLETED";
    const full = !isPast && chance(0.25);
    const bookedCount = full ? session.capacity : Math.round(session.capacity * faker.number.float({ min: isPast ? 0.4 : 0.15, max: 1 }));
    const waitlistCount = full ? int(1, 4) : 0;
    const people = sample(bookable, bookedCount + waitlistCount);
    people.forEach((m, i) => {
      const bookedAt = new Date(session.startsAt.getTime() - int(2, 96) * 3_600_000);
      if (i >= bookedCount) {
        bookings.push({ gymId, sessionId: session.id, memberId: m.id, status: "WAITLISTED", waitlistPosition: i - bookedCount + 1, bookedAt, createdAt: bookedAt });
        return;
      }
      const status = isPast ? weighted([["ATTENDED", 85], ["NO_SHOW", 10], ["CANCELLED", 5]] as const) : full ? "BOOKED" : weighted([["BOOKED", 95], ["CANCELLED", 5]] as const);
      bookings.push({ gymId, sessionId: session.id, memberId: m.id, status, bookedAt, cancelledAt: status === "CANCELLED" ? new Date(bookedAt.getTime() + 3_600_000) : null, createdAt: bookedAt });
    });
  }
  await insertMany("bookings", bookings, (chunk) => db.booking.createMany({ data: chunk }));

  // ── Staff shifts (same 4 weeks) ──────────────────────────────────────────
  const shifts: Prisma.StaffShiftCreateManyInput[] = [];
  for (let day = weekStart; day < weekStart + 28; day++) {
    const sunday = localDay(day).dow === 0;
    byRole("FRONT_DESK").forEach((s, i) => {
      const morning = (day + i) % 2 === 0;
      if (sunday && !morning) return;
      shifts.push({ gymId, staffId: s.id, locationId: locations[i % locations.length].id, startsAt: at(day, sunday ? 7 : morning ? 6 : 14), endsAt: at(day, sunday ? 13 : morning ? 14 : 22) });
    });
    for (const t of trainers) {
      if (sunday || !chance(0.6)) continue;
      const startHour = pick([6, 7, 16, 17]);
      shifts.push({ gymId, staffId: t.id, locationId: pick(locations).id, startsAt: at(day, startHour), endsAt: at(day, startHour + int(4, 5)) });
    }
  }
  await insertMany("staff shifts", shifts, (chunk) => db.staffShift.createMany({ data: chunk }));

  // ── In-app notifications ─────────────────────────────────────────────────
  const notifications: Prisma.NotificationCreateManyInput[] = [];
  const memberName = new Map(memberRows.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));
  for (const ms of memberships.filter((x) => x.status === "ACTIVE" && x.end >= 0 && x.end <= 7)) {
    for (const r of alertRecipients) {
      notifications.push({
        gymId,
        recipientUserId: r.userId,
        type: "MEMBERSHIP_EXPIRING",
        title: "Membership expiring soon",
        body: `${memberName.get(ms.memberId)}'s membership ends in ${ms.end} day${ms.end === 1 ? "" : "s"}.`,
        entityType: "Membership",
        entityId: ms.id,
        dedupeKey: `membership_expiring:${ms.id}:${r.userId}`,
        readAt: chance(0.3) ? past(at(0, 8)) : null,
        createdAt: past(at(Math.max(ms.end - 7, -7), 6)),
      });
    }
  }
  for (const invoiceId of overdueInvoiceIds) {
    const inv = invoices.find((i) => i.id === invoiceId)!;
    for (const r of alertRecipients.filter((s) => s.role !== "FRONT_DESK")) {
      notifications.push({
        gymId,
        recipientUserId: r.userId,
        type: "PAYMENT_OVERDUE",
        title: "Payment overdue",
        body: `Invoice INV-${String(inv.number).padStart(6, "0")} for ${memberName.get(inv.memberId)} is overdue.`,
        entityType: "Invoice",
        entityId: invoiceId,
        dedupeKey: `payment_overdue:${invoiceId}:${r.userId}`,
        readAt: chance(0.2) ? past(at(0, 8)) : null,
        createdAt: past(at(0, 6)),
      });
    }
  }
  await insertMany("notifications", notifications, (chunk) => db.notification.createMany({ data: chunk }));

  // ── Audit log (no personal data in `changes`) ─────────────────────────────
  const audit: Prisma.AuditLogCreateManyInput[] = [];
  const ip = () => `10.0.${int(0, 9)}.${int(2, 254)}`;
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
  for (const row of [...memberRows].sort((a, b) => (b.memberNumber as number) - (a.memberNumber as number)).slice(0, 40)) {
    const actor = pick(deskStaff);
    audit.push({ gymId, actorUserId: actor.userId, actorType: "USER", action: "member.create", entityType: "Member", entityId: row.id, changes: { memberNumber: row.memberNumber, encryptedFields: "[redacted]" }, ip: ip(), userAgent: ua, createdAt: row.createdAt as Date });
  }
  for (const p of [...payments].sort((a, b) => (b.receivedAt as Date).getTime() - (a.receivedAt as Date).getTime()).slice(0, 60)) {
    const actor = staff.find((s) => s.id === p.recordedById)!;
    audit.push({ gymId, actorUserId: actor.userId, actorType: "USER", action: "payment.record", entityType: "Payment", entityId: p.id, changes: { amountMinor: p.amountMinor, method: p.method, invoiceId: p.invoiceId }, ip: ip(), userAgent: ua, createdAt: p.receivedAt as Date });
  }
  for (const r of refunds) {
    const actor = staff.find((s) => s.id === r.recordedById)!;
    audit.push({ gymId, actorUserId: actor.userId, actorType: "USER", action: "payment.refund", entityType: "Payment", entityId: r.paymentId, changes: { amountMinor: r.amountMinor }, ip: ip(), userAgent: ua, createdAt: r.refundedAt as Date });
  }
  for (const ms of memberships.filter((x) => x.status === "FROZEN")) {
    audit.push({ gymId, actorUserId: pick(deskStaff).userId, actorType: "USER", action: "membership.freeze", entityType: "Membership", entityId: ms.id, changes: { status: { from: "ACTIVE", to: "FROZEN" } }, ip: ip(), userAgent: ua, createdAt: at(ms.freeze![0], 10) });
  }
  const owner = byRole("OWNER")[0];
  audit.push({ gymId, actorUserId: owner.userId, actorType: "USER", action: "settings.update", entityType: "Gym", entityId: gymId, changes: { taxRateBps: { from: 1200, to: TAX_BPS } }, ip: ip(), userAgent: ua, createdAt: at(-spec.createdDaysAgo + 1, 12) });
  for (const s of staff.filter((x) => x.role !== "OWNER").slice(0, 4)) {
    audit.push({ gymId, actorUserId: owner.userId, actorType: "USER", action: "staff.invite_accepted", entityType: "StaffMember", entityId: s.id, changes: { role: s.role }, ip: ip(), userAgent: ua, createdAt: at(-spec.createdDaysAgo + 2, 12) });
  }
  await insertMany("audit log entries", audit, (chunk) => db.auditLog.createMany({ data: chunk }));

  // Platform-level login history for this gym's staff.
  await db.platformAuditLog.createMany({
    data: staff.flatMap((s) =>
      Array.from({ length: int(1, 4) }, () => ({ actorUserId: s.userId, gymId, action: "auth.login", ip: ip(), userAgent: ua, createdAt: past(at(-int(0, 14), int(6, 21), int(0, 59))) }))
    ),
  });

  // ── Per-gym counters continue after the seeded numbers ────────────────────
  await db.gymCounter.createMany({
    data: [
      { gymId, key: "member", value: memberRows.length },
      { gymId, key: "invoice", value: invoices.length },
    ],
  });

  return logins;
}
