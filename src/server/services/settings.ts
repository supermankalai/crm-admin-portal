import "server-only";
import type { z } from "zod";
import { recordAudit } from "@/server/audit/tenant-audit";
import { NotFoundError, ValidationError } from "@/server/errors";
import { assertWithinLimit } from "@/server/plan/limits";
import type { RequestMeta } from "@/server/security/request-meta";
import { getStorage, inspectImage, storageKey } from "@/server/storage";
import { assertCan, assertWritable, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";
import type { brandingSchema, gymProfileSchema, locationSchema, openingHoursSchema } from "@/lib/validation/settings";

/**
 * Gym settings (owner only). Every change is audited with a before/after diff. The database
 * also enforces this: only the gym's owner may UPDATE its Gym row (RLS gym_owner_update).
 */

type Profile = z.infer<typeof gymProfileSchema>;

function guard(ctx: TenantContext) {
  assertCan(ctx, "settings.manage");
  assertWritable(ctx);
}

function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(after)) if (before[k] !== v) changes[k] = { from: before[k], to: v };
  return changes;
}

export async function getSettings(ctx: TenantContext) {
  assertCan(ctx, "settings.manage");
  return inTenant(ctx, async (tx) => {
    const gym = await tx.gym.findUniqueOrThrow({
      where: { id: ctx.gym.id },
      select: { name: true, email: true, phone: true, address: true, timezone: true, currency: true, taxRateBps: true, brandColor: true, logoFileId: true },
    });
    const locations = await tx.location.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, address: true, isActive: true, openingHours: { orderBy: { dayOfWeek: "asc" }, select: { dayOfWeek: true, openMinute: true, closeMinute: true, isClosed: true } } },
    });
    // Money already recorded in a currency can't silently change meaning.
    const moneyRecords = (await tx.invoice.count()) + (await tx.payment.count());
    return { gym, locations, currencyLocked: moneyRecords > 0 };
  });
}

export async function updateGymProfile(ctx: TenantContext, input: Profile, meta: RequestMeta) {
  guard(ctx);
  return inTenant(ctx, async (tx) => {
    const before = await tx.gym.findUniqueOrThrow({
      where: { id: ctx.gym.id },
      select: { name: true, email: true, phone: true, address: true, timezone: true, currency: true, taxRateBps: true },
    });
    if (input.currency !== before.currency) {
      const used = (await tx.invoice.count()) + (await tx.payment.count());
      if (used > 0) throw new ValidationError("The currency can't change after invoices or payments have been recorded.", { currency: ["Locked: invoices or payments already use this currency."] });
    }
    const next = { name: input.name, email: input.email, phone: input.phone, address: input.address, timezone: input.timezone, currency: input.currency, taxRateBps: input.taxRate };
    const changes = diff(before, next);
    if (Object.keys(changes).length === 0) return { changed: 0 };
    await tx.gym.update({ where: { id: ctx.gym.id }, data: next, select: { id: true } });
    await recordAudit(tx, ctx, { action: "settings.update", entityType: "Gym", entityId: ctx.gym.id, changes }, meta);
    return { changed: Object.keys(changes).length };
  });
}

export async function saveOpeningHours(ctx: TenantContext, input: z.infer<typeof openingHoursSchema>, meta: RequestMeta) {
  guard(ctx);
  return inTenant(ctx, async (tx) => {
    const location = await tx.location.findUnique({ where: { id: input.locationId }, select: { id: true, name: true } });
    if (!location) throw new NotFoundError("Location not found.");
    for (const d of input.days) {
      await tx.openingHours.upsert({
        where: { locationId_dayOfWeek: { locationId: location.id, dayOfWeek: d.dayOfWeek } },
        create: { gymId: ctx.gym.id, locationId: location.id, ...d },
        update: { openMinute: d.openMinute, closeMinute: d.closeMinute, isClosed: d.isClosed },
        select: { id: true },
      });
    }
    await recordAudit(tx, ctx, { action: "settings.hours_update", entityType: "Location", entityId: location.id, changes: { days: input.days } }, meta);
  });
}

export async function saveLocation(ctx: TenantContext, input: z.infer<typeof locationSchema>, meta: RequestMeta) {
  guard(ctx);
  return inTenant(ctx, async (tx) => {
    if (input.locationId) {
      const before = await tx.location.findUnique({ where: { id: input.locationId }, select: { name: true, address: true } });
      if (!before) throw new NotFoundError("Location not found.");
      await tx.location.update({ where: { id: input.locationId }, data: { name: input.name, address: input.address }, select: { id: true } });
      await recordAudit(tx, ctx, { action: "location.update", entityType: "Location", entityId: input.locationId, changes: diff(before, { name: input.name, address: input.address }) }, meta);
      return { locationId: input.locationId };
    }
    await assertWithinLimit(ctx, tx, "locations");
    const created = await tx.location.create({ data: { gymId: ctx.gym.id, name: input.name, address: input.address }, select: { id: true } });
    // New locations start with the same default hours as at sign-up (06:00–22:00 daily).
    await tx.openingHours.createMany({ data: Array.from({ length: 7 }, (_, d) => ({ gymId: ctx.gym.id, locationId: created.id, dayOfWeek: d, openMinute: 360, closeMinute: 1320 })) });
    await recordAudit(tx, ctx, { action: "location.create", entityType: "Location", entityId: created.id, changes: { name: input.name } }, meta);
    return { locationId: created.id };
  });
}

export async function updateBranding(ctx: TenantContext, input: z.infer<typeof brandingSchema>, meta: RequestMeta) {
  guard(ctx);
  return inTenant(ctx, async (tx) => {
    const before = await tx.gym.findUniqueOrThrow({ where: { id: ctx.gym.id }, select: { brandColor: true } });
    if (before.brandColor === input.brandColor) return;
    await tx.gym.update({ where: { id: ctx.gym.id }, data: { brandColor: input.brandColor }, select: { id: true } });
    await recordAudit(tx, ctx, { action: "settings.branding_update", entityType: "Gym", entityId: ctx.gym.id, changes: { brandColor: { from: before.brandColor, to: input.brandColor } } }, meta);
  });
}

/** Replace the gym logo. The bytes are type-checked by content (JPEG/PNG/WebP, ≤ 2 MB). */
export async function setGymLogo(ctx: TenantContext, bytes: Buffer, meta: RequestMeta) {
  guard(ctx);
  if (!ctx.staffId) throw new NotFoundError();
  const staffId = ctx.staffId;
  const image = inspectImage(bytes);
  const key = storageKey(ctx.gym.id, "gym-logo", image.ext);
  const storage = getStorage();
  await storage.put(key, bytes);
  try {
    const oldKey = await inTenant(ctx, async (tx) => {
      const gym = await tx.gym.findUniqueOrThrow({ where: { id: ctx.gym.id }, select: { logoFileId: true } });
      const asset = await tx.fileAsset.create({
        data: { gymId: ctx.gym.id, kind: "GYM_LOGO", storageKey: key, mimeType: image.mimeType, sizeBytes: bytes.length, sha256: image.sha256, uploadedById: staffId },
        select: { id: true },
      });
      await tx.gym.update({ where: { id: ctx.gym.id }, data: { logoFileId: asset.id }, select: { id: true } });
      let previous: string | null = null;
      if (gym.logoFileId) {
        const old = await tx.fileAsset.findUnique({ where: { id: gym.logoFileId }, select: { storageKey: true } });
        await tx.fileAsset.deleteMany({ where: { id: gym.logoFileId } });
        previous = old?.storageKey ?? null;
      }
      await recordAudit(tx, ctx, { action: "settings.logo_update", entityType: "Gym", entityId: ctx.gym.id, changes: { fileId: asset.id, bytes: bytes.length, type: image.mimeType } }, meta);
      return previous;
    });
    if (oldKey) await storage.remove(oldKey);
  } catch (error) {
    await storage.remove(key); // don't leave orphaned files behind
    throw error;
  }
}

export async function removeGymLogo(ctx: TenantContext, meta: RequestMeta) {
  guard(ctx);
  const oldKey = await inTenant(ctx, async (tx) => {
    const gym = await tx.gym.findUniqueOrThrow({ where: { id: ctx.gym.id }, select: { logoFileId: true } });
    if (!gym.logoFileId) return null;
    const old = await tx.fileAsset.findUnique({ where: { id: gym.logoFileId }, select: { storageKey: true } });
    await tx.gym.update({ where: { id: ctx.gym.id }, data: { logoFileId: null }, select: { id: true } });
    await tx.fileAsset.deleteMany({ where: { id: gym.logoFileId } });
    await recordAudit(tx, ctx, { action: "settings.logo_remove", entityType: "Gym", entityId: ctx.gym.id }, meta);
    return old?.storageKey ?? null;
  });
  if (oldKey) await getStorage().remove(oldKey);
}
