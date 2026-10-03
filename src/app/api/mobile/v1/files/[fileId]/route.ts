import { NextResponse, type NextRequest } from "next/server";
import { withUser } from "@/server/db/context";
import { toMobileUser } from "@/server/mobile/auth";
import { verifyFileSignature } from "@/server/mobile/files";
import { readGymFile } from "@/server/services/members/commands";
import { readMemberVisibleFile } from "@/server/services/member-files";
import { resolveMemberContext } from "@/server/tenant/member";
import { resolveTenantByGymId } from "@/server/tenant/resolve";

const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/mobile/v1/files/:fileId?u&g&e&s — a file for the mobile app via a short-lived signed URL.
 * The signature (5 minutes) says who it was issued to; their access to the gym and to this file is
 * checked again here, so revoking access stops working links immediately. 404 for anything else.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  if (!/^[\w-]{10,64}$/.test(fileId)) return notFound();
  const who = verifyFileSignature(fileId, request.nextUrl.searchParams);
  if (!who) return notFound();

  const dbUser = await withUser(who.userId, (tx) => tx.user.findUnique({ where: { id: who.userId }, select: { id: true, name: true, email: true, isSuperAdmin: true } }));
  if (!dbUser) return notFound();
  const user = toMobileUser(dbUser);
  const staff = await resolveTenantByGymId(user, who.gymId);
  let file: { mimeType: string; bytes: Buffer } | null = null;
  if (staff) file = await readGymFile(staff, fileId);
  else {
    const member = await resolveMemberContext(user, { id: who.gymId });
    if (member) file = await readMemberVisibleFile(member, fileId);
  }
  if (!file) return notFound();

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.bytes.length),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
