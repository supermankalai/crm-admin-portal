import "server-only";
import { ValidationError } from "@/server/errors";

/** Cursor = "<ISO time>|<id>" (base64url), for stable newest-first paging of mobile lists. */
export function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !/^[\w-]{1,64}$/.test(id ?? "")) throw new Error();
    return { at, id };
  } catch {
    throw new ValidationError("Invalid cursor.");
  }
}

export const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");

/** Take `limit` of the `limit + 1` rows fetched; the extra row says whether there's a next page. */
export function page<T>(rows: T[], limit: number, key: (row: T) => { at: Date; id: string }) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(key(last).at, key(last).id) : null };
}

/** Rows strictly after the cursor in (field desc, id desc) order. */
export const before = (field: string, c: { at: Date; id: string } | null) =>
  c ? { OR: [{ [field]: { lt: c.at } }, { [field]: c.at, id: { lt: c.id } }] } : {};
