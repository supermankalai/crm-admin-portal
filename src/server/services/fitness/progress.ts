import "server-only";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import sharp from "sharp";
import { addDays, fromDateString, localDate, toDateString, type DateString } from "@/domain/dates";
import type { Measurements } from "@/domain/progress";
import { decryptJson, encryptJson } from "@/server/crypto";
import type { Tx } from "@/server/db/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { signedPhotoPath } from "@/server/mobile/files";
import { getStorage, IMAGE_TYPES } from "@/server/storage";
import { inTenant } from "@/server/tenant/guards";
import { inMember, type MemberContext } from "@/server/tenant/member";
import type { TenantContext } from "@/server/tenant/types";
import { assertMemberWritable } from "./common";

/**
 * Body measurements and progress photos. Measurements are one encrypted JSON blob per day.
 * Photos are re-encoded on upload (which drops EXIF — phone photos carry GPS location), stored
 * outside the web root, and only ever reach clients as 5-minute signed links. Who may see them is
 * enforced by RLS: the member, and their assigned trainers.
 */

export const MAX_PHOTOS_PER_MEMBER = 200;
const PHOTO_MAX_SIDE = 1600;

const entryCrypto = (gymId: string, id: string) => ({ gymId, model: "ProgressEntry", field: "measurements", recordId: id });

export function readEntries(tx: Tx, gymId: string, memberId: string, sinceDays = 730) {
  return tx.progressEntry
    .findMany({
      where: { memberId, recordedOn: { gte: new Date(Date.now() - sinceDays * 86_400_000) } },
      orderBy: { recordedOn: "asc" },
      select: { id: true, recordedOn: true, measurementsEnc: true },
    })
    .then((rows) =>
      rows.flatMap((r) => {
        try {
          return [{ id: r.id, recordedOn: toDateString(r.recordedOn), values: decryptJson<Measurements>(r.measurementsEnc, entryCrypto(gymId, r.id)) }];
        } catch (error) {
          logger.error("progress entry decryption failed", { gymId, recordId: r.id, error: (error as Error).message });
          return [];
        }
      })
    );
}

/** Photos with signed links for this viewer. RLS decides which rows the viewer can see at all. */
export async function readPhotos(tx: Tx, viewer: { userId: string; gymId: string }, memberId: string, take = 60) {
  const rows = await tx.progressPhoto.findMany({ where: { memberId }, orderBy: [{ takenOn: "desc" }, { createdAt: "desc" }], take, select: { id: true, takenOn: true } });
  return rows.map((p) => ({ id: p.id, takenOn: toDateString(p.takenOn), url: signedPhotoPath(p.id, viewer.userId, viewer.gymId) }));
}

function assertRecordDate(day: DateString, timezone: string) {
  const today = localDate(new Date(), timezone);
  if (day > today) throw new ValidationError("That date is in the future.", { recordedOn: ["That date is in the future."] });
  if (day < addDays(today, -5 * 365)) throw new ValidationError("That date is too far in the past.", { recordedOn: ["That date is too far in the past."] });
}

// ─────────────────────────────── Member ───────────────────────────────

export function memberProgress(ctx: MemberContext) {
  return inMember(ctx, async (tx) => ({
    entries: await readEntries(tx, ctx.gym.id, ctx.memberId),
    photos: await readPhotos(tx, { userId: ctx.user.id, gymId: ctx.gym.id }, ctx.memberId),
  }));
}

/** One entry per day: logging again for the same day replaces it. */
export function saveProgress(ctx: MemberContext, input: { recordedOn: DateString; values: Measurements }) {
  assertMemberWritable(ctx);
  assertRecordDate(input.recordedOn, ctx.gym.timezone);
  return inMember(ctx, async (tx) => {
    const day = fromDateString(input.recordedOn);
    const existing = await tx.progressEntry.findFirst({ where: { memberId: ctx.memberId, recordedOn: day }, select: { id: true } });
    const id = existing?.id ?? createId();
    const measurementsEnc = encryptJson(input.values, entryCrypto(ctx.gym.id, id));
    if (existing) await tx.progressEntry.update({ where: { id }, data: { measurementsEnc }, select: { id: true } });
    else await tx.progressEntry.create({ data: { id, gymId: ctx.gym.id, memberId: ctx.memberId, recordedOn: day, measurementsEnc }, select: { id: true } });
    return { id, recordedOn: input.recordedOn };
  });
}

export async function deleteProgress(ctx: MemberContext, entryId: string) {
  assertMemberWritable(ctx);
  const { count } = await inMember(ctx, (tx) => tx.progressEntry.deleteMany({ where: { id: entryId, memberId: ctx.memberId } }));
  if (!count) throw new NotFoundError("Entry not found.");
  return { ok: true as const };
}

/**
 * Check the real type from the bytes, then re-encode as JPEG: apply the camera's rotation, cap the
 * size, and drop every bit of metadata (sharp writes none unless asked).
 */
export async function processPhoto(bytes: Buffer) {
  if (bytes.length === 0) throw new ValidationError("The file is empty.", { photo: ["The file is empty."] });
  if (!Object.values(IMAGE_TYPES).some((t) => t.magic(bytes))) throw new ValidationError("Upload a JPEG, PNG or WebP photo.", { photo: ["Upload a JPEG, PNG or WebP photo."] });
  let out: Buffer;
  try {
    out = await sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new ValidationError("That image couldn't be read. Try another photo.", { photo: ["That image couldn't be read."] });
  }
  return { bytes: out, mimeType: "image/jpeg" as const, sha256: createHash("sha256").update(out).digest("hex") };
}

export async function uploadPhoto(ctx: MemberContext, raw: Buffer, takenOn: DateString) {
  assertMemberWritable(ctx);
  assertRecordDate(takenOn, ctx.gym.timezone);
  const count = await inMember(ctx, (tx) => tx.progressPhoto.count({ where: { memberId: ctx.memberId } }));
  if (count >= MAX_PHOTOS_PER_MEMBER) throw new ValidationError(`You can keep up to ${MAX_PHOTOS_PER_MEMBER} photos. Delete some old ones first.`);
  const photo = await processPhoto(raw);
  const key = `${ctx.gym.id}/progress-photo/${randomUUID()}.jpg`;
  const storage = getStorage();
  await storage.put(key, photo.bytes);
  try {
    return await inMember(ctx, async (tx) => {
      const row = await tx.progressPhoto.create({
        data: { gymId: ctx.gym.id, memberId: ctx.memberId, takenOn: fromDateString(takenOn), storageKey: key, mimeType: photo.mimeType, sizeBytes: photo.bytes.length, sha256: photo.sha256 },
        select: { id: true, takenOn: true },
      });
      return { id: row.id, takenOn: toDateString(row.takenOn), url: signedPhotoPath(row.id, ctx.user.id, ctx.gym.id) };
    });
  } catch (error) {
    await storage.remove(key);
    throw error;
  }
}

export async function deletePhoto(ctx: MemberContext, photoId: string) {
  assertMemberWritable(ctx);
  const key = await inMember(ctx, async (tx) => {
    const p = await tx.progressPhoto.findFirst({ where: { id: photoId, memberId: ctx.memberId }, select: { id: true, storageKey: true } });
    if (!p) throw new NotFoundError("Photo not found.");
    await tx.progressPhoto.delete({ where: { id: p.id } });
    return p.storageKey;
  });
  await getStorage().remove(key);
  return { ok: true as const };
}

// ─────────────────────────────── Serving ───────────────────────────────

export async function readPhotoAsMember(ctx: MemberContext, photoId: string) {
  const p = await inMember(ctx, (tx) => tx.progressPhoto.findFirst({ where: { id: photoId }, select: { storageKey: true, mimeType: true } }));
  return p ? { mimeType: p.mimeType, bytes: await getStorage().get(p.storageKey) } : null;
}

/** Staff: RLS returns the row only to the member's assigned trainers (not managers or owners). */
export async function readPhotoAsStaff(ctx: TenantContext, photoId: string) {
  const p = await inTenant(ctx, (tx) => tx.progressPhoto.findFirst({ where: { id: photoId }, select: { storageKey: true, mimeType: true } }));
  return p ? { mimeType: p.mimeType, bytes: await getStorage().get(p.storageKey) } : null;
}
