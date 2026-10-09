import { NextResponse, type NextRequest } from "next/server";
import { withUser } from "@/server/db/context";
import { toMobileUser } from "@/server/mobile/auth";
import { verifyPhotoSignature } from "@/server/mobile/files";
import { readPhotoAsMember, readPhotoAsStaff } from "@/server/services/fitness/progress";
import { resolveMemberContext } from "@/server/tenant/member";
import { resolveTenantByGymId } from "@/server/tenant/resolve";

const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/mobile/v1/progress-photos/:photoId?u&g&e&s — a progress photo via a 5-minute signed URL.
 * Access is checked again here: the member themselves, or one of their assigned trainers (RLS).
 * Managers and owners get a 404 like anyone else.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;
  if (!/^[\w-]{10,64}$/.test(photoId)) return notFound();
  const who = verifyPhotoSignature(photoId, request.nextUrl.searchParams);
  if (!who) return notFound();

  const dbUser = await withUser(who.userId, (tx) => tx.user.findUnique({ where: { id: who.userId }, select: { id: true, name: true, email: true, isSuperAdmin: true } }));
  if (!dbUser) return notFound();
  const user = toMobileUser(dbUser);
  const staff = await resolveTenantByGymId(user, who.gymId);
  let photo: { mimeType: string; bytes: Buffer } | null = null;
  if (staff) photo = await readPhotoAsStaff(staff, photoId);
  else {
    const member = await resolveMemberContext(user, { id: who.gymId });
    if (member) photo = await readPhotoAsMember(member, photoId);
  }
  if (!photo) return notFound();

  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.mimeType,
      "Content-Length": String(photo.bytes.length),
      // Private: the device may keep it for the link's lifetime, shared caches never.
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
