import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { handleLiveWebhook } from "@/server/services/live/webhook";

/**
 * POST /api/livekit/webhook: LiveKit's room and participant events (set the server's webhook to
 * this URL with this app's API key). Only signed events are processed; see handleLiveWebhook.
 */

const MAX_BODY_BYTES = 64 * 1024;
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: NextRequest) {
  try {
    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413, headers: HEADERS });
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413, headers: HEADERS });
    const result = await handleLiveWebhook(body, request.headers.get("authorization"));
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.code }, { status: error.status, headers: HEADERS });
    logger.error("livekit webhook error", { error });
    return NextResponse.json({ error: "internal" }, { status: 500, headers: HEADERS });
  }
}
