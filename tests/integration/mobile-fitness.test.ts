import { readFile } from "node:fs/promises";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as loginRoute from "@/app/api/mobile/v1/auth/login/route";
import * as selectGymRoute from "@/app/api/mobile/v1/auth/select-gym/route";
import * as progressEntryRoute from "@/app/api/mobile/v1/member/progress/[entryId]/route";
import * as photoDeleteRoute from "@/app/api/mobile/v1/member/progress/photos/[photoId]/route";
import * as photosRoute from "@/app/api/mobile/v1/member/progress/photos/route";
import * as progressRoute from "@/app/api/mobile/v1/member/progress/route";
import * as memberSessionsRoute from "@/app/api/mobile/v1/member/training-sessions/route";
import * as completeRoute from "@/app/api/mobile/v1/member/workouts/[dayId]/complete/route";
import * as workoutsRoute from "@/app/api/mobile/v1/member/workouts/route";
import * as fileRoute from "@/app/api/mobile/v1/files/[fileId]/route";
import * as photoFileRoute from "@/app/api/mobile/v1/progress-photos/[photoId]/route";
import * as staffClassRoute from "@/app/api/mobile/v1/staff/classes/[sessionId]/route";
import * as attendanceRoute from "@/app/api/mobile/v1/trainer/bookings/[bookingId]/attendance/route";
import * as notesRoute from "@/app/api/mobile/v1/trainer/clients/[memberId]/notes/route";
import * as clientRoute from "@/app/api/mobile/v1/trainer/clients/[memberId]/route";
import * as clientsRoute from "@/app/api/mobile/v1/trainer/clients/route";
import * as scheduleRoute from "@/app/api/mobile/v1/trainer/schedule/route";
import * as sessionRoute from "@/app/api/mobile/v1/trainer/training-sessions/[trainingSessionId]/route";
import * as sessionsRoute from "@/app/api/mobile/v1/trainer/training-sessions/route";
import * as assignRoute from "@/app/api/mobile/v1/trainer/workout-plans/[planId]/assign/route";
import * as planRoute from "@/app/api/mobile/v1/trainer/workout-plans/[planId]/route";
import * as plansRoute from "@/app/api/mobile/v1/trainer/workout-plans/route";
import { addDays, fromDateString, localDate } from "@/domain/dates";
import { hashPassword } from "@/server/auth/password";
import { appDb } from "@/server/db/client";
import { withMember, withTenant } from "@/server/db/context";
import { getEnv } from "@/server/env";
import { signedPhotoPath } from "@/server/mobile/files";
import { createTwoGyms, type World } from "../support/fixtures";
import { callApi, device } from "../support/mobile-api";
import { disconnectAll, getOwnerDb, truncateAll } from "../support/test-db";

/** Mobile Phase 5: trainers, workout plans, progress tracking, photos, notes and PT sessions. */

const TZ = "Asia/Kolkata";
const PASSWORD = "Fitness-Pass-2026";
let w: World;
const ids = { trainer1: "", trainer2: "", manager: "", member: "", memberUser: "", otherMember: "", classId: "", bookingId: "" };
const tokens = { trainer1: "", trainer2: "", manager: "", desk: "", member: "", other: "", ownerB: "" };
const today = () => localDate(new Date(), TZ);

async function token(identifier: string, slug: string) {
  const login = await callApi<{ accessToken: string }>(loginRoute.POST, { body: { identifier, password: PASSWORD, device: device() } });
  const scoped = await callApi<{ accessToken: string }>(selectGymRoute.POST, { token: login.body.accessToken, body: { gymSlug: slug } });
  if (scoped.status !== 200) throw new Error(`select-gym ${identifier} ${scoped.status}`);
  return scoped.body.accessToken;
}

const plan = (title: string, status = "ACTIVE", days = [{ title: "Day A", exercises: [{ name: "Squat", sets: "5", reps: "5", restSeconds: "120", notes: "" }] }]) => ({ title, notes: "Keep the back straight", status, days });

async function getPhoto(url: string) {
  const u = new URL(url, "http://localhost");
  const id = u.pathname.split("/").pop()!;
  const res = u.pathname.includes("/files/") ? await fileRoute.GET(new NextRequest(u), { params: Promise.resolve({ fileId: id }) }) : await photoFileRoute.GET(new NextRequest(u), { params: Promise.resolve({ photoId: id }) });
  return { status: res.status, type: res.headers.get("content-type"), bytes: Buffer.from(await res.arrayBuffer()) };
}

beforeAll(async () => {
  await truncateAll();
  w = await createTwoGyms();
  const db = getOwnerDb();
  const hash = await hashPassword(PASSWORD);
  await db.user.updateMany({ data: { passwordHash: hash } });
  const plan = await db.platformPlan.update({ where: { code: "TEST" }, data: { maxMembers: 100, maxStaff: 20 } });
  for (const g of [w.gymA, w.gymB]) {
    await db.gym.update({ where: { id: g.id }, data: { status: "ACTIVE", timezone: TZ } });
    await db.gymSubscription.create({ data: { gymId: g.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  }
  const staff = async (email: string, role: "TRAINER" | "MANAGER") => {
    const u = await db.user.create({ data: { email, name: email.split("@")[0], passwordHash: hash } });
    return (await db.staffMember.create({ data: { gymId: w.gymA.id, userId: u.id, role } })).id;
  };
  ids.trainer1 = await staff("trainer1@fit.test", "TRAINER");
  ids.trainer2 = await staff("trainer2@fit.test", "TRAINER");
  ids.manager = await staff("manager@fit.test", "MANAGER");

  // Member with an app account, assigned to trainer 1; a second member assigned to nobody.
  const memberUser = await db.user.create({ data: { email: "client@fit.test", name: "Client", passwordHash: hash } });
  ids.memberUser = memberUser.id;
  ids.member = w.memberA.id;
  await db.memberAccount.create({ data: { gymId: w.gymA.id, memberId: w.memberA.id, userId: memberUser.id } });
  await db.trainerClient.create({ data: { gymId: w.gymA.id, trainerId: ids.trainer1, memberId: w.memberA.id } });
  const mp = await db.membershipPlan.create({ data: { gymId: w.gymA.id, name: "Monthly", type: "MONTHLY", priceMinor: 100, durationDays: 30 } });
  await db.membership.create({ data: { id: createId(), gymId: w.gymA.id, memberId: w.memberA.id, planId: mp.id, startDate: fromDateString(addDays(today(), -5)), endDate: fromDateString(addDays(today(), 25)), priceMinor: 100 } });
  const other = await db.member.create({ data: { gymId: w.gymA.id, memberNumber: 77, firstName: "Olga", lastName: "Other", checkInCode: "OTHER00077" } });
  ids.otherMember = other.id;
  const otherUser = await db.user.create({ data: { email: "other@fit.test", name: "Other", passwordHash: hash } });
  await db.memberAccount.create({ data: { gymId: w.gymA.id, memberId: other.id, userId: otherUser.id } });

  // A class taught by trainer 1, starting now, with the client booked.
  const loc = await db.location.create({ data: { gymId: w.gymA.id, name: "Main" } });
  const room = await db.room.create({ data: { gymId: w.gymA.id, locationId: loc.id, name: "Studio", capacity: 20 } });
  const type = await db.classType.create({ data: { gymId: w.gymA.id, name: "Strength", color: "#ef4444", durationMinutes: 60, defaultCapacity: 10 } });
  ids.classId = (await db.classSession.create({ data: { gymId: w.gymA.id, classTypeId: type.id, trainerId: ids.trainer1, roomId: room.id, startsAt: new Date(Date.now() - 10 * 60_000), endsAt: new Date(Date.now() + 50 * 60_000), capacity: 10 } })).id;
  ids.bookingId = (await db.booking.create({ data: { gymId: w.gymA.id, sessionId: ids.classId, memberId: w.memberA.id, status: "BOOKED" } })).id;

  tokens.trainer1 = await token("trainer1@fit.test", "gym-a");
  tokens.trainer2 = await token("trainer2@fit.test", "gym-a");
  tokens.manager = await token("manager@fit.test", "gym-a");
  tokens.desk = await token(w.users.deskA.email, "gym-a");
  tokens.member = await token("client@fit.test", "gym-a");
  tokens.other = await token("other@fit.test", "gym-a");
  tokens.ownerB = await token(w.users.ownerB.email, "gym-b");
});

afterAll(async () => {
  await appDb.$disconnect();
  await disconnectAll();
});

describe("workout plans", () => {
  let planId = "";
  let dayId = "";

  it("a trainer writes a plan for their client, and the member sees it with the trainer's name", async () => {
    const created = await callApi<{ planId: string }>(plansRoute.POST, { token: tokens.trainer1, body: { ...plan("Strength block"), memberId: ids.member } });
    expect(created.status).toBe(201);
    planId = created.body.planId;
    const mine = await callApi<{ plans: { title: string; trainer: string; notes: string; days: { id: string; exercises: { name: string; sets: number }[] }[] }[] }>(workoutsRoute.GET, { token: tokens.member });
    expect(mine.status).toBe(200);
    expect(mine.body.plans).toHaveLength(1);
    expect(mine.body.plans[0]).toMatchObject({ title: "Strength block", trainer: "trainer1", notes: "Keep the back straight" });
    expect(mine.body.plans[0].days[0].exercises[0]).toMatchObject({ name: "Squat", sets: 5 });
    dayId = mine.body.plans[0].days[0].id;
    // Notes are encrypted at rest.
    const raw = await getOwnerDb().workoutPlan.findUniqueOrThrow({ where: { id: planId } });
    expect(raw.notesEnc).not.toContain("back straight");
  });

  it("other members, other trainers and the front desk can't reach it", async () => {
    expect((await callApi<{ plans: unknown[] }>(workoutsRoute.GET, { token: tokens.other })).body.plans).toEqual([]);
    expect((await callApi(planRoute.GET, { token: tokens.trainer2, params: { planId } })).status).toBe(404);
    expect((await callApi(plansRoute.POST, { token: tokens.trainer2, body: { ...plan("Nope"), memberId: ids.member } })).status).toBe(403);
    expect((await callApi(plansRoute.GET, { token: tokens.desk })).status).toBe(403);
    expect((await callApi(planRoute.GET, { token: tokens.ownerB, params: { planId } })).status).toBe(404);
    expect((await callApi(planRoute.PUT, { token: tokens.trainer2, params: { planId }, body: plan("Hijack") })).status).toBe(404);
  });

  it("the member marks a day done once (a double tap isn't counted twice)", async () => {
    const a = await callApi<{ completionId: string }>(completeRoute.POST, { token: tokens.member, params: { dayId }, body: { note: "Felt strong" } });
    const b = await callApi<{ completionId: string }>(completeRoute.POST, { token: tokens.member, params: { dayId }, body: { note: "" } });
    expect(a.status).toBe(201);
    expect(b.body.completionId).toBe(a.body.completionId);
    expect((await callApi(completeRoute.POST, { token: tokens.other, params: { dayId }, body: { note: "" } })).status).toBe(404);
    const mine = await callApi<{ plans: { days: { timesCompleted: number; lastCompletedAt: string | null }[] }[]; thisWeek: number }>(workoutsRoute.GET, { token: tokens.member });
    expect(mine.body.plans[0].days[0].timesCompleted).toBe(1);
    expect(mine.body.thisWeek).toBe(1);
  });

  it("editing the plan keeps the member's history; days are matched by position", async () => {
    const updated = await callApi(planRoute.PUT, {
      token: tokens.trainer1,
      params: { planId },
      body: plan("Strength block v2", "ACTIVE", [
        { title: "Day A (heavy)", exercises: [{ name: "Deadlift", sets: "3", reps: "5", restSeconds: "180", notes: "" }] },
        { title: "Day B", exercises: [{ name: "Bench press", sets: "4", reps: "6-8", restSeconds: "", notes: "" }] },
      ]),
    });
    expect(updated.status).toBe(200);
    const mine = await callApi<{ plans: { title: string; days: { id: string; title: string; timesCompleted: number }[] }[] }>(workoutsRoute.GET, { token: tokens.member });
    expect(mine.body.plans[0].title).toBe("Strength block v2");
    expect(mine.body.plans[0].days.map((d) => d.title)).toEqual(["Day A (heavy)", "Day B"]);
    expect(mine.body.plans[0].days[0]).toMatchObject({ id: dayId, timesCompleted: 1 });
  });

  it("validates plans with the shared schema", async () => {
    const bad = await callApi<{ error: { code: string } }>(plansRoute.POST, { token: tokens.trainer1, body: { ...plan("x", "ACTIVE", []), memberId: null } });
    expect(bad.status).toBe(422);
    const badSets = await callApi(plansRoute.POST, { token: tokens.trainer1, body: { ...plan("x", "ACTIVE", [{ title: "A", exercises: [{ name: "Row", sets: "500", reps: "", restSeconds: "", notes: "" }] }]), memberId: null } });
    expect(badSets.status).toBe(422);
  });

  it("a template is copied to a client on assignment; drafts stay hidden from the member", async () => {
    const tpl = await callApi<{ planId: string }>(plansRoute.POST, { token: tokens.trainer1, body: { ...plan("Mobility", "DRAFT"), memberId: null } });
    const copy = await callApi<{ planId: string }>(assignRoute.POST, { token: tokens.trainer1, params: { planId: tpl.body.planId }, body: { memberId: ids.member } });
    expect(copy.status).toBe(201);
    expect(copy.body.planId).not.toBe(tpl.body.planId);
    const mine = await callApi<{ plans: { title: string }[] }>(workoutsRoute.GET, { token: tokens.member });
    expect(mine.body.plans.map((p) => p.title).sort()).toEqual(["Mobility", "Strength block v2"]);
    expect((await callApi(assignRoute.POST, { token: tokens.trainer1, params: { planId: tpl.body.planId }, body: { memberId: ids.otherMember } })).status).toBe(403);
    const list = await callApi<{ plans: { title: string; member: unknown }[] }>(plansRoute.GET, { token: tokens.trainer1 });
    expect(list.body.plans.find((p) => p.title === "Mobility" && p.member === null)).toBeTruthy();
  });
});

describe("progress measurements", () => {
  it("logs one encrypted entry per day; logging the same day replaces it", async () => {
    const first = await callApi<{ id: string }>(progressRoute.POST, { token: tokens.member, body: { recordedOn: addDays(today(), -7), weightKg: "84", bodyFatPct: "", chestCm: "", waistCm: "90", hipsCm: "", armCm: "", thighCm: "" } });
    expect(first.status).toBe(201);
    const again = await callApi<{ id: string }>(progressRoute.POST, { token: tokens.member, body: { recordedOn: addDays(today(), -7), weightKg: "83,6", bodyFatPct: "", chestCm: "", waistCm: "", hipsCm: "", armCm: "", thighCm: "" } });
    expect(again.body.id).toBe(first.body.id);
    await callApi(progressRoute.POST, { token: tokens.member, body: { recordedOn: today(), weightKg: "82.5", bodyFatPct: "18", chestCm: "", waistCm: "", hipsCm: "", armCm: "", thighCm: "" } });
    const got = await callApi<{ entries: { recordedOn: string; values: Record<string, number> }[] }>(progressRoute.GET, { token: tokens.member });
    expect(got.body.entries).toEqual([
      { id: first.body.id, recordedOn: addDays(today(), -7), values: { weightKg: 83.6 } },
      expect.objectContaining({ recordedOn: today(), values: { weightKg: 82.5, bodyFatPct: 18 } }),
    ]);
    const raw = await getOwnerDb().progressEntry.findMany({ where: { memberId: ids.member } });
    for (const r of raw) expect(r.measurementsEnc).not.toMatch(/82\.5|83\.6|weight/);
  });

  it("rejects empty, out-of-range and future entries", async () => {
    const empty = { recordedOn: today(), weightKg: "", bodyFatPct: "", chestCm: "", waistCm: "", hipsCm: "", armCm: "", thighCm: "" };
    expect((await callApi(progressRoute.POST, { token: tokens.member, body: empty })).status).toBe(422);
    expect((await callApi(progressRoute.POST, { token: tokens.member, body: { ...empty, weightKg: "999" } })).status).toBe(422);
    expect((await callApi(progressRoute.POST, { token: tokens.member, body: { ...empty, recordedOn: addDays(today(), 2), weightKg: "80" } })).status).toBe(422);
  });

  it("only the member can delete their entries", async () => {
    const e = await callApi<{ id: string }>(progressRoute.POST, { token: tokens.member, body: { recordedOn: addDays(today(), -30), weightKg: "86", bodyFatPct: "", chestCm: "", waistCm: "", hipsCm: "", armCm: "", thighCm: "" } });
    expect((await callApi(progressEntryRoute.DELETE, { token: tokens.other, params: { entryId: e.body.id } })).status).toBe(404);
    expect((await callApi(progressEntryRoute.DELETE, { token: tokens.member, params: { entryId: e.body.id } })).status).toBe(200);
  });
});

describe("progress photos", () => {
  let photo: { id: string; url: string };

  it("strips metadata (location) and stores a re-encoded JPEG", async () => {
    const withGps = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#7c3aed" } })
      .jpeg()
      .withExif({ IFD0: { ImageDescription: "GPS-SECRET-42", Artist: "Phone Owner" } })
      .toBuffer();
    expect(withGps.includes(Buffer.from("GPS-SECRET-42"))).toBe(true);
    const form = new FormData();
    form.append("takenOn", today());
    form.append("photo", new Blob([new Uint8Array(withGps)], { type: "image/jpeg" }), "me.jpg");
    const r = await callApi<{ id: string; url: string; takenOn: string }>(photosRoute.POST, { token: tokens.member, form });
    expect(r.status).toBe(201);
    photo = r.body;
    expect(photo.url).toMatch(/^\/api\/mobile\/v1\/progress-photos\//);
    const row = await getOwnerDb().progressPhoto.findUniqueOrThrow({ where: { id: photo.id } });
    const stored = await readFile(path.resolve(getEnv().STORAGE_DIR, row.storageKey));
    expect(stored.includes(Buffer.from("GPS-SECRET-42"))).toBe(false);
    expect(stored.includes(Buffer.from("Phone Owner"))).toBe(false);
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
  });

  it("refuses files that aren't images, whatever they claim to be", async () => {
    const form = new FormData();
    form.append("takenOn", today());
    form.append("photo", new Blob([new TextEncoder().encode("<script>alert(1)</script>")], { type: "image/jpeg" }), "x.jpg");
    const r = await callApi(photosRoute.POST, { token: tokens.member, form });
    expect(r.status).toBe(422);
    const json = await callApi(photosRoute.POST, { token: tokens.member, body: { takenOn: today() } });
    expect(json.status).toBe(415);
  });

  it("is served to the member and their assigned trainer only — not managers, other trainers or other gyms", async () => {
    const own = await getPhoto(photo.url);
    expect(own).toMatchObject({ status: 200, type: "image/jpeg" });

    const asTrainer = await callApi<{ photos: { id: string; url: string }[] | null; isMyClient: boolean }>(clientRoute.GET, { token: tokens.trainer1, params: { memberId: ids.member } });
    expect(asTrainer.body.isMyClient).toBe(true);
    expect(asTrainer.body.photos?.map((p) => p.id)).toEqual([photo.id]);
    expect((await getPhoto(asTrainer.body.photos![0].url)).status).toBe(200);
    const audit = await getOwnerDb().auditLog.findFirst({ where: { gymId: w.gymA.id, action: "progress_photo.view", entityId: ids.member } });
    expect(audit).not.toBeNull();

    const asManager = await callApi<{ photos: unknown; progress: unknown[] }>(clientRoute.GET, { token: tokens.manager, params: { memberId: ids.member } });
    expect(asManager.status).toBe(200);
    expect(asManager.body.photos).toBeNull();
    expect(asManager.body.progress.length).toBeGreaterThan(0); // measurements: yes; photos: no
    const managerUser = await getOwnerDb().staffMember.findUniqueOrThrow({ where: { id: ids.manager } });
    expect((await getPhoto(signedPhotoPath(photo.id, managerUser.userId, w.gymA.id))).status).toBe(404);

    const trainer2 = await getOwnerDb().staffMember.findUniqueOrThrow({ where: { id: ids.trainer2 } });
    expect((await getPhoto(signedPhotoPath(photo.id, trainer2.userId, w.gymA.id))).status).toBe(404);
    expect((await getPhoto(signedPhotoPath(photo.id, w.users.ownerB.id, w.gymB.id))).status).toBe(404);
    expect((await getPhoto(photo.url.replace(/s=[^&]+/, "s=forged"))).status).toBe(404);
    // A logo-style link for the same id doesn't open the photo.
    expect((await getPhoto(photo.url.replace("/progress-photos/", "/files/"))).status).toBe(404);
  });

  it("the database itself hides photos from managers (RLS), not just the API", async () => {
    const managerUser = await getOwnerDb().staffMember.findUniqueOrThrow({ where: { id: ids.manager } });
    const seen = await withTenant({ userId: managerUser.userId, gymId: w.gymA.id }, (tx) => tx.progressPhoto.findMany());
    expect(seen).toEqual([]);
    const trainerUser = await getOwnerDb().staffMember.findUniqueOrThrow({ where: { id: ids.trainer1 } });
    expect(await withTenant({ userId: trainerUser.userId, gymId: w.gymA.id }, (tx) => tx.progressPhoto.count())).toBe(1);
    const otherAccount = await getOwnerDb().memberAccount.findFirstOrThrow({ where: { memberId: ids.otherMember } });
    expect(await withMember({ userId: otherAccount.userId, gymId: w.gymA.id, memberId: ids.otherMember }, (tx) => tx.progressPhoto.count())).toBe(0);
  });

  it("deleting removes the row and the file", async () => {
    const row = await getOwnerDb().progressPhoto.findUniqueOrThrow({ where: { id: photo.id } });
    expect((await callApi(photoDeleteRoute.DELETE, { token: tokens.other, params: { photoId: photo.id } })).status).toBe(404);
    expect((await callApi(photoDeleteRoute.DELETE, { token: tokens.member, params: { photoId: photo.id } })).status).toBe(200);
    await expect(readFile(path.resolve(getEnv().STORAGE_DIR, row.storageKey))).rejects.toThrow();
  });
});

describe("clients and private notes", () => {
  it("trainers list only their clients; others get a 404 for someone else's client", async () => {
    const mine = await callApi<{ clients: { memberId: string; status: string; activePlan: string | null }[] }>(clientsRoute.GET, { token: tokens.trainer1 });
    expect(mine.body.clients).toEqual([expect.objectContaining({ memberId: ids.member, status: "active", activePlan: expect.any(String) })]);
    expect((await callApi<{ clients: unknown[] }>(clientsRoute.GET, { token: tokens.trainer2 })).body.clients).toEqual([]);
    expect((await callApi(clientRoute.GET, { token: tokens.trainer2, params: { memberId: ids.member } })).status).toBe(404);
    expect((await callApi(clientRoute.GET, { token: tokens.trainer1, params: { memberId: w.memberB.id } })).status).toBe(404);
    expect((await callApi(clientsRoute.GET, { token: tokens.desk })).status).toBe(403);
  });

  it("notes are encrypted, visible to their author and managers, and never to the member", async () => {
    const n = await callApi<{ id: string; body: string; mine: boolean }>(notesRoute.POST, { token: tokens.trainer1, params: { memberId: ids.member }, body: { body: "Left knee niggle — avoid deep lunges" } });
    expect(n.status).toBe(201);
    expect((await getOwnerDb().trainerClientNote.findUniqueOrThrow({ where: { id: n.body.id } })).bodyEnc).not.toContain("knee");
    expect((await callApi(notesRoute.POST, { token: tokens.trainer2, params: { memberId: ids.member }, body: { body: "x" } })).status).toBe(403);

    const asManager = await callApi<{ notes: { body: string; mine: boolean; author: string }[] }>(clientRoute.GET, { token: tokens.manager, params: { memberId: ids.member } });
    expect(asManager.body.notes).toEqual([expect.objectContaining({ body: "Left knee niggle — avoid deep lunges", mine: false, author: "trainer1" })]);

    const account = await getOwnerDb().memberAccount.findFirstOrThrow({ where: { memberId: ids.member } });
    expect(await withMember({ userId: account.userId, gymId: w.gymA.id, memberId: ids.member }, (tx) => tx.trainerClientNote.count())).toBe(0);
  });

  it("shows the client's completed workouts with their note", async () => {
    const r = await callApi<{ completions: { note: string | null }[] }>(clientRoute.GET, { token: tokens.trainer1, params: { memberId: ids.member } });
    expect(r.body.completions[0].note).toBe("Felt strong");
  });
});

describe("personal training sessions and the schedule", () => {
  let sessionId = "";
  const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

  it("books a session with a client, refusing double bookings", async () => {
    const r = await callApi<{ id: string }>(sessionsRoute.POST, { token: tokens.trainer1, body: { memberId: ids.member, startsAt: at(24), durationMinutes: "60", focus: "Squat technique" } });
    expect(r.status).toBe(201);
    sessionId = r.body.id;
    const clash = await callApi<{ error: { code: string } }>(sessionsRoute.POST, { token: tokens.trainer1, body: { memberId: ids.member, startsAt: at(24.5), durationMinutes: "30", focus: "" } });
    expect([clash.status, clash.body.error.code]).toEqual([409, "conflict"]);
    const duringClass = await callApi(sessionsRoute.POST, { token: tokens.trainer1, body: { memberId: ids.member, startsAt: at(0.1), durationMinutes: "30", focus: "" } });
    expect(duringClass.status).toBe(409);
    expect((await callApi(sessionsRoute.POST, { token: tokens.trainer2, body: { memberId: ids.member, startsAt: at(48), durationMinutes: "60", focus: "" } })).status).toBe(403);
    expect((await callApi(sessionsRoute.POST, { token: tokens.trainer1, body: { memberId: ids.member, startsAt: at(-48), durationMinutes: "60", focus: "" } })).status).toBe(422);
  });

  it("the member sees it with the trainer's name; the trainer's schedule has classes and sessions", async () => {
    const mine = await callApi<{ sessions: { id: string; trainer: string; focus: string }[] }>(memberSessionsRoute.GET, { token: tokens.member });
    expect(mine.body.sessions).toEqual([expect.objectContaining({ id: sessionId, trainer: "trainer1", focus: "Squat technique" })]);
    expect((await callApi<{ sessions: unknown[] }>(memberSessionsRoute.GET, { token: tokens.other })).body.sessions).toEqual([]);
    const schedule = await callApi<{ items: { kind: string; id: string }[] }>(scheduleRoute.GET, { token: tokens.trainer1 });
    expect(schedule.body.items.map((i) => [i.kind, i.id])).toEqual(expect.arrayContaining([["class", ids.classId], ["pt", sessionId]]));
    expect((await callApi<{ items: unknown[] }>(scheduleRoute.GET, { token: tokens.trainer2 })).body.items).toEqual([]);
  });

  it("can only be marked done after it starts; cancelling closes it", async () => {
    expect((await callApi(sessionRoute.PATCH, { token: tokens.trainer1, params: { trainingSessionId: sessionId }, body: { status: "COMPLETED" } })).status).toBe(422);
    expect((await callApi(sessionRoute.PATCH, { token: tokens.trainer2, params: { trainingSessionId: sessionId }, body: { status: "CANCELLED" } })).status).toBe(403);
    expect((await callApi(sessionRoute.PATCH, { token: tokens.trainer1, params: { trainingSessionId: sessionId }, body: { status: "CANCELLED" } })).status).toBe(200);
    expect((await callApi(sessionRoute.PATCH, { token: tokens.trainer1, params: { trainingSessionId: sessionId }, body: { status: "CANCELLED" } })).status).toBe(409);
  });

  it("the class's trainer marks attendance; another trainer can't", async () => {
    const detail = await callApi<{ canMarkAttendance: boolean }>(staffClassRoute.GET, { token: tokens.trainer1, params: { sessionId: ids.classId } });
    expect(detail.body.canMarkAttendance).toBe(true);
    expect((await callApi(attendanceRoute.POST, { token: tokens.trainer2, params: { bookingId: ids.bookingId }, body: { attended: true } })).status).toBe(403);
    const r = await callApi<{ status: string }>(attendanceRoute.POST, { token: tokens.trainer1, params: { bookingId: ids.bookingId }, body: { attended: true } });
    expect(r.body).toEqual({ status: "ATTENDED" });
  });
});

describe("read-only gyms", () => {
  it("members can still read but not log while the gym is read-only", async () => {
    const db = getOwnerDb();
    await db.gymSubscription.updateMany({ where: { gymId: w.gymA.id }, data: { status: "EXPIRED" } });
    try {
      const member = await token("client@fit.test", "gym-a");
      expect((await callApi(workoutsRoute.GET, { token: member })).status).toBe(200);
      const r = await callApi<{ error: { code: string } }>(progressRoute.POST, { token: member, body: { recordedOn: today(), weightKg: "80", bodyFatPct: "", chestCm: "", waistCm: "", hipsCm: "", armCm: "", thighCm: "" } });
      expect([r.status, r.body.error.code]).toEqual([409, "read_only"]);
      const trainer = await token("trainer1@fit.test", "gym-a");
      expect((await callApi(notesRoute.POST, { token: trainer, params: { memberId: ids.member }, body: { body: "x" } })).status).toBe(409);
    } finally {
      await db.gymSubscription.updateMany({ where: { gymId: w.gymA.id }, data: { status: "ACTIVE" } });
    }
  });
});
