import { NextResponse } from "next/server";
import { readGymFile } from "@/server/services/members/commands";
import { getGymAccess } from "@/server/tenant";

/**
 * GET /api/g/:gymSlug/files/:fileId — serves a gym's uploaded file (member photo, logo)
 * to signed-in staff of that gym only. 404 for everyone else, including other gyms' staff.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gymSlug: string; fileId: string }> }) {
  const { gymSlug, fileId } = await params;
  const ctx = await getGymAccess(gymSlug);
  if (!ctx || !/^[\w-]{10,64}$/.test(fileId)) return new NextResponse("Not found", { status: 404 });

  const file = await readGymFile(ctx, fileId);
  if (!file) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.bytes.length),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
