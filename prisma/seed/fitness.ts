import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { PrismaClient } from "@/generated/prisma/client";
import { encryptField, encryptJson } from "@/server/crypto";
import { getStorage } from "@/server/storage";
import { GYMS } from "./config";
import { at, dateOnly, id } from "./lib";

/**
 * Trainer and member fitness data (mobile Phase 5): workout plans and templates, workouts done,
 * weekly measurements, progress photos, private trainer notes and personal training sessions.
 * Deterministic (no faker), so the rest of the seed stays identical.
 *
 *   trainer1@<gym domain> coaches member1@<gym domain> (the demo member app login), who has an
 *   active plan, three months of measurements, three progress photos and PT sessions.
 */

const PLANS = [
  {
    title: "Strength foundations",
    notes: "Three full-body days a week. Add weight when every set feels easy.",
    days: [
      { title: "Day A — Squat focus", exercises: [["Back squat", 4, "6-8", 150], ["Bench press", 3, "8", 120], ["Seated row", 3, "10", 90], ["Plank", 3, "45 s", 60]] },
      { title: "Day B — Hinge focus", exercises: [["Romanian deadlift", 4, "8", 150], ["Overhead press", 3, "8", 120], ["Lat pulldown", 3, "10", 90], ["Farmer's carry", 3, "30 m", 60]] },
      { title: "Day C — Full body", exercises: [["Goblet squat", 3, "12", 90], ["Push-ups", 3, "AMRAP", 60], ["Dumbbell row", 3, "10", 90], ["Dead bug", 3, "10", 45]] },
    ],
  },
  {
    title: "Fat loss conditioning",
    notes: "Keep rest short. Walk 8,000 steps on non-training days.",
    days: [
      { title: "Circuit 1", exercises: [["Kettlebell swing", 4, "15", 45], ["Walking lunge", 4, "12", 45], ["Battle ropes", 4, "30 s", 45]] },
      { title: "Circuit 2", exercises: [["Rower", 5, "250 m", 60], ["Box step-up", 4, "10", 45], ["Mountain climbers", 4, "30 s", 45]] },
    ],
  },
] as const;

const TEMPLATE = {
  title: "Beginner full body (template)",
  notes: "Starting point for new clients — adjust loads at the first session.",
  days: [{ title: "Full body", exercises: [["Leg press", 3, "12", 90], ["Chest press machine", 3, "12", 90], ["Cable row", 3, "12", 90], ["Bird dog", 3, "10", 45]] }],
} as const;

const NOTES = [
  "Old shoulder injury — keep overhead pressing light and pain-free.",
  "Goal: first unassisted pull-up by the end of the quarter.",
  "Sleeping badly this month; keep sessions moderate.",
  "Wants to run a 10K in spring — add a conditioning day later.",
];

type Plan = { title: string; notes: string; days: readonly { title: string; exercises: readonly (readonly [string, number, string, number])[] }[] };

async function createPlan(db: PrismaClient, gymId: string, trainerId: string, memberId: string | null, plan: Plan, status: "DRAFT" | "ACTIVE", createdDaysAgo: number) {
  const planId = id();
  await db.workoutPlan.create({
    data: {
      id: planId,
      gymId,
      trainerId,
      memberId,
      title: plan.title,
      notesEnc: encryptField(plan.notes, { gymId, model: "WorkoutPlan", field: "notes", recordId: planId }),
      status,
      createdAt: at(-createdDaysAgo, 10),
      days: {
        create: plan.days.map((d, i) => ({
          position: i,
          title: d.title,
          exercises: { create: d.exercises.map(([name, sets, reps, rest], j) => ({ position: j, name, sets, reps, restSeconds: rest, notes: null })) },
        })),
      },
    },
  });
  return db.workoutPlanDay.findMany({ where: { planId }, orderBy: { position: "asc" }, select: { id: true } });
}

/** A plain coloured square (no metadata) standing in for a progress photo. */
function photoBytes(hue: number) {
  const r = 120 + ((hue * 37) % 100);
  const g = 90 + ((hue * 53) % 120);
  return sharp({ create: { width: 480, height: 640, channels: 3, background: { r, g, b: 160 } } }).jpeg({ quality: 70 }).toBuffer();
}

/** Files from a previous seed: their rows are about to be truncated, so remove them from storage. */
export async function removeSeededPhotoFiles(db: PrismaClient) {
  // Before the first Phase 5 migration the table doesn't exist yet: nothing to clean up.
  const rows = await db.progressPhoto.findMany({ select: { storageKey: true } }).catch(() => []);
  const storage = getStorage();
  for (const r of rows) await storage.remove(r.storageKey).catch(() => undefined);
}

export async function seedFitness(db: PrismaClient) {
  const storage = getStorage();
  for (const spec of GYMS) {
    const gym = await db.gym.findUniqueOrThrow({ where: { slug: spec.slug }, select: { id: true } });
    const gymId = gym.id;
    const trainers = await db.staffMember.findMany({ where: { gymId, role: "TRAINER", status: "ACTIVE" }, select: { id: true, user: { select: { email: true } } } });
    trainers.sort((a, b) => (a.user.email ?? "").localeCompare(b.user.email ?? "", undefined, { numeric: true }));
    const [trainer1] = trainers;
    if (!trainer1) continue;

    // The demo member (member1@…) is trainer1's client.
    const demoAccount = await db.memberAccount.findFirst({ where: { gymId, user: { email: `member1@${spec.emailDomain}` } }, select: { memberId: true } });
    if (demoAccount) {
      await db.trainerClient.upsert({
        where: { trainerId_memberId: { trainerId: trainer1.id, memberId: demoAccount.memberId } },
        create: { gymId, trainerId: trainer1.id, memberId: demoAccount.memberId, createdAt: at(-90, 10) },
        update: {},
      });
    }

    // Measurements belong to the member, not the trainer: seed them once even with two trainers.
    const measured = new Set<string>();
    for (const [t, trainer] of trainers.entries()) {
      await createPlan(db, gymId, trainer.id, null, TEMPLATE, "DRAFT", 120);
      const links = await db.trainerClient.findMany({ where: { trainerId: trainer.id, member: { deletedAt: null } }, orderBy: { createdAt: "asc" }, take: 6, select: { memberId: true } });
      const demo = t === 0 ? demoAccount?.memberId : undefined;
      const clients = demo ? [demo, ...links.map((l) => l.memberId).filter((m) => m !== demo)] : links.map((l) => l.memberId);

      for (const [c, memberId] of clients.entries()) {
        const isDemo = memberId === demoAccount?.memberId;
        const plan = PLANS[(t + c) % PLANS.length];
        const days = await createPlan(db, gymId, trainer.id, memberId, plan, "ACTIVE", 35);

        // Workouts done: about three a week over the last four weeks.
        const completions = [];
        for (let w = 4; w >= 1; w--) {
          for (let k = 0; k < 3; k++) {
            if ((w + k + c) % 5 === 0 && !isDemo) continue;
            const completionId = id();
            const note = k === 0 && w === 1 ? "Felt strong today" : null;
            completions.push({
              id: completionId,
              gymId,
              memberId,
              dayId: days[k % days.length].id,
              completedAt: at(-(w * 7) + k * 2, 7 + ((c + k) % 10)),
              noteEnc: note ? encryptField(note, { gymId, model: "WorkoutCompletion", field: "note", recordId: completionId }) : null,
            });
          }
        }
        await db.workoutCompletion.createMany({ data: completions });

        // Weekly measurements for 12 weeks, trending the right way.
        const startWeight = 62 + ((c * 7 + t * 5) % 30);
        const startWaist = 78 + ((c * 3 + t) % 20);
        const entries = Array.from({ length: 12 }, (_, i) => {
          const entryId = id();
          const values = {
            weightKg: Math.round((startWeight - i * 0.4 + ((i * 3) % 4) * 0.2) * 10) / 10,
            waistCm: Math.round((startWaist - i * 0.3) * 10) / 10,
            ...(i % 4 === 0 ? { bodyFatPct: Math.round((24 - i * 0.25) * 10) / 10 } : {}),
          };
          return { id: entryId, gymId, memberId, recordedOn: dateOnly(-(11 - i) * 7), measurementsEnc: encryptJson(values, { gymId, model: "ProgressEntry", field: "measurements", recordId: entryId }) };
        });
        if (!measured.has(memberId)) await db.progressEntry.createMany({ data: entries });
        measured.add(memberId);

        // Private notes on some clients.
        if (isDemo || c % 2 === 0) {
          const noteId = id();
          await db.trainerClientNote.create({
            data: { id: noteId, gymId, memberId, authorId: trainer.id, bodyEnc: encryptField(NOTES[(t + c) % NOTES.length], { gymId, model: "TrainerClientNote", field: "body", recordId: noteId }), createdAt: at(-20 + c, 12) },
          });
        }

        // PT sessions: three past, two upcoming (early mornings, before group classes).
        const sessions = [-21, -14, -7, 2, 9].map((day, i) => ({
          gymId,
          trainerId: trainer.id,
          memberId,
          startsAt: at(day, 6, (c % 2) * 30),
          endsAt: at(day, 7, (c % 2) * 30),
          status: day > 0 ? ("SCHEDULED" as const) : i === 1 && !isDemo ? ("NO_SHOW" as const) : ("COMPLETED" as const),
          focus: ["Technique check", "Progress review", "Conditioning", "New programme walkthrough", "Mobility"][i],
        }));
        // Spread trainers' clients across days so a trainer never has two at once.
        await db.trainingSession.createMany({ data: sessions.map((s) => ({ ...s, startsAt: new Date(s.startsAt.getTime() + c * 86_400_000), endsAt: new Date(s.endsAt.getTime() + c * 86_400_000) })) });

        // Progress photos for the demo member.
        if (isDemo) {
          for (const [p, daysAgo] of [56, 28, 0].entries()) {
            const bytes = await photoBytes(p + t);
            // Random, not the seed's deterministic ids: the dev and test databases share one storage
            // folder, and each seed only removes the files its own rows point to.
            const key = `${gymId}/progress-photo/${randomUUID()}.jpg`;
            await storage.put(key, bytes);
            await db.progressPhoto.create({ data: { gymId, memberId, takenOn: dateOnly(-daysAgo), storageKey: key, mimeType: "image/jpeg", sizeBytes: bytes.length, sha256: "seed" } });
          }
        }
      }
    }
  }
}
