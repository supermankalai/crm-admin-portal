import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@fitcrm/shared/api/openapi";
import { getEnv } from "@/server/env";

/** GET /api/mobile/v1/openapi.json — generated from the shared contract (public, no data). */
export function GET() {
  return NextResponse.json(buildOpenApiDocument(getEnv().APP_URL), { headers: { "Cache-Control": "public, max-age=300" } });
}
