import "server-only";
import { recordAudit } from "@/server/audit/tenant-audit";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { RequestMeta } from "@/server/security/request-meta";
import { assertCan, inTenant } from "@/server/tenant/guards";
import type { TenantContext } from "@/server/tenant/types";

/** Class types and rooms: the building blocks of the schedule. */

export function listClassSetup(ctx: TenantContext) {
  assertCan(ctx, "classes.view");
  return inTenant(ctx, async (tx) => {
    const classTypes = await tx.classType.findMany({ orderBy: { name: "asc" } });
    const rooms = await tx.room.findMany({ orderBy: [{ location: { name: "asc" } }, { name: "asc" }], include: { location: { select: { id: true, name: true } } } });
    const locations = await tx.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    const trainers = await tx.staffMember.findMany({
      where: { status: "ACTIVE", role: { in: ["TRAINER", "MANAGER", "OWNER"] } },
      orderBy: { user: { name: "asc" } },
      select: { id: true, role: true, user: { select: { name: true } } },
    });
    return { classTypes, rooms, locations, trainers: trainers.map((t) => ({ id: t.id, name: t.user.name, role: t.role })) };
  });
}

function uniqueName(error: unknown, label: string): never {
  if (error instanceof Error && /Unique constraint|_name_key|unique/i.test(error.message)) {
    throw new ValidationError(`A ${label} with this name already exists.`, { name: [`A ${label} with this name already exists.`] });
  }
  throw error;
}

export async function saveClassType(
  ctx: TenantContext,
  input: { classTypeId?: string; name: string; description: string | null; color: string; durationMinutes: number; defaultCapacity: number },
  meta: RequestMeta
) {
  assertCan(ctx, "classes.manage");
  const { classTypeId, ...data } = input;
  try {
    return await inTenant(ctx, async (tx) => {
      if (classTypeId) {
        const found = await tx.classType.findUnique({ where: { id: classTypeId }, select: { id: true } });
        if (!found) throw new NotFoundError("Class type not found.");
        await tx.classType.update({ where: { id: classTypeId }, data, select: { id: true } });
        await recordAudit(tx, ctx, { action: "class_type.update", entityType: "ClassType", entityId: classTypeId, changes: data }, meta);
        return { id: classTypeId };
      }
      const created = await tx.classType.create({ data: { gymId: ctx.gym.id, ...data }, select: { id: true } });
      await recordAudit(tx, ctx, { action: "class_type.create", entityType: "ClassType", entityId: created.id, changes: data }, meta);
      return created;
    });
  } catch (error) {
    uniqueName(error, "class type");
  }
}

export async function saveRoom(ctx: TenantContext, input: { roomId?: string; locationId: string; name: string; capacity: number }, meta: RequestMeta) {
  assertCan(ctx, "classes.manage");
  const { roomId, ...data } = input;
  try {
    return await inTenant(ctx, async (tx) => {
      const location = await tx.location.findFirst({ where: { id: data.locationId, isActive: true }, select: { id: true } });
      if (!location) throw new ValidationError("Choose a location.", { locationId: ["Choose a location"] });
      if (roomId) {
        const found = await tx.room.findUnique({ where: { id: roomId }, select: { id: true } });
        if (!found) throw new NotFoundError("Room not found.");
        await tx.room.update({ where: { id: roomId }, data, select: { id: true } });
        await recordAudit(tx, ctx, { action: "room.update", entityType: "Room", entityId: roomId, changes: data }, meta);
        return { id: roomId };
      }
      const created = await tx.room.create({ data: { gymId: ctx.gym.id, ...data }, select: { id: true } });
      await recordAudit(tx, ctx, { action: "room.create", entityType: "Room", entityId: created.id, changes: data }, meta);
      return created;
    });
  } catch (error) {
    uniqueName(error, "room");
  }
}
