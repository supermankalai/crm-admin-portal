import { NextResponse, type NextRequest } from "next/server";
import { localDate } from "@/domain/dates";
import { REPORT_KINDS, resolveRange, type ReportKind } from "@/domain/reports";
import { FeatureNotInPlanError, ForbiddenError } from "@/server/errors";
import { logger } from "@/server/logger";
import { metaFromHeaders } from "@/server/security/request-meta";
import { exportReport } from "@/server/services/reports";
import { getGymAccess } from "@/server/tenant";

/**
 * GET /api/g/:gymSlug/reports/:report?from=YYYY-MM-DD&to=YYYY-MM-DD → CSV download.
 * Same checks as the reports page plus the export permission and the plan's CSV feature.
 * 404 for anyone who isn't staff of this gym.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ gymSlug: string; report: string }> }) {
  const { gymSlug, report } = await params;
  const ctx = await getGymAccess(gymSlug, `GET /api/g/${gymSlug}/reports/${report}`);
  if (!ctx || !(REPORT_KINDS as readonly string[]).includes(report)) return new NextResponse("Not found", { status: 404 });

  const sp = request.nextUrl.searchParams;
  const range = resolveRange(sp.get("from") ?? undefined, sp.get("to") ?? undefined, localDate(new Date(), ctx.gym.timezone));
  try {
    const { filename, csv } = await exportReport(ctx, report as ReportKind, range, metaFromHeaders(request.headers));
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof FeatureNotInPlanError) return new NextResponse(error.message, { status: 402 });
    if (error instanceof ForbiddenError) return new NextResponse("You don't have permission to export reports.", { status: 403 });
    logger.error("report export failed", { report, error });
    return new NextResponse("The export failed. Please try again.", { status: 500 });
  }
}
