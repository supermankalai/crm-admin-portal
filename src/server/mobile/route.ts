import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Endpoint } from "@fitcrm/shared/api/contract";
import { AppError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { planLimitErrorFrom } from "@/server/plan/limits";
import { RateLimitError } from "@/server/security/rate-limit";
import { metaFromHeaders, type RequestMeta } from "@/server/security/request-meta";
import { authenticateGym, authenticateUser, type GymAuth, type MemberAuth, type StaffAuth, type UserAuth } from "./context";

/**
 * Every mobile endpoint is built with mobileRoute(contractEntry, handler):
 *   authenticate (per the contract's auth level) → validate params/query/body with the contract's
 *   Zod schemas → run the handler → filter the result through the response schema (unknown
 *   fields are dropped, so nothing extra can leak) → consistent JSON errors.
 */

type AuthFor<A extends Endpoint["auth"]> = A extends "none" ? null : A extends "user" ? UserAuth : A extends "staff" ? StaffAuth : A extends "member" ? MemberAuth : GymAuth;
type In<T> = T extends z.ZodType ? z.output<T> : undefined;

export type MobileHandlerArgs<E extends Endpoint> = {
  req: NextRequest;
  meta: RequestMeta;
  auth: AuthFor<E["auth"]>;
  params: In<E["params"]>;
  query: In<E["query"]>;
  body: In<E["body"]>;
  /** The uploaded file's bytes, for upload endpoints (type not yet checked — the service sniffs it). */
  file: E["upload"] extends object ? Buffer : undefined;
};

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BODY_BYTES = 64 * 1024;

function errorBody(code: string, message: string, fieldErrors?: Record<string, string[]>) {
  return { error: { code, message, ...(fieldErrors && Object.keys(fieldErrors).length ? { fieldErrors } : {}) } };
}

export function errorResponse(error: unknown, auth?: unknown): NextResponse {
  if (error instanceof RateLimitError) {
    return NextResponse.json(errorBody("rate_limited", error.message), { status: 429, headers: { ...NO_STORE, "Retry-After": String(error.retryAfterSeconds) } });
  }
  // The database enforces plan limits too; show the same upgrade message.
  const staff = auth && typeof auth === "object" && "staff" in auth ? (auth as StaffAuth).staff : null;
  const planLimit = staff ? planLimitErrorFrom(error, staff) : null;
  const e = planLimit ?? error;
  if (e instanceof ValidationError) return NextResponse.json(errorBody(e.code, e.message, e.fieldErrors), { status: e.status, headers: NO_STORE });
  if (e instanceof AppError) return NextResponse.json(errorBody(e.code, e.message), { status: e.status, headers: NO_STORE });
  logger.error("mobile api error", { error: e });
  return NextResponse.json(errorBody("internal", "Something went wrong. Please try again."), { status: 500, headers: NO_STORE });
}

function parse<T extends z.ZodType>(schema: T, value: unknown, what: string): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(what === "body" ? "Please check the highlighted fields." : `Invalid ${what}.`, z.flattenError(result.error).fieldErrors as Record<string, string[]>);
  }
  return result.data;
}

class BadRequestError extends AppError {
  constructor(message: string, status = 400) {
    super(message, "bad_request", status);
  }
}

export function mobileRoute<E extends Endpoint>(def: E, handler: (args: MobileHandlerArgs<E>) => Promise<z.input<E["response"]>>) {
  return async (req: NextRequest, segment?: { params?: Promise<Record<string, string | string[]>> }) => {
    let auth: unknown = null;
    try {
      const meta = metaFromHeaders(req.headers);
      if (def.auth === "user") auth = await authenticateUser(req.headers);
      else if (def.auth !== "none") auth = await authenticateGym(req.headers, def.auth);

      const params = def.params ? parse(def.params, (await segment?.params) ?? {}, "path") : undefined;
      const query = def.query ? parse(def.query, Object.fromEntries(req.nextUrl.searchParams), "query") : undefined;
      let body: unknown;
      let file: Buffer | undefined;
      if (def.upload) {
        const length = Number(req.headers.get("content-length") ?? 0);
        if (length > def.upload.maxBytes + MAX_BODY_BYTES) throw new BadRequestError("The file is too large.", 413);
        if (!req.headers.get("content-type")?.includes("multipart/form-data")) throw new BadRequestError("Send multipart/form-data.", 415);
        let form: FormData;
        try {
          form = await req.formData();
        } catch {
          throw new BadRequestError("Malformed upload.");
        }
        const part = form.get(def.upload.field);
        if (!part || typeof part === "string") throw new ValidationError("Choose a file to upload.", { [def.upload.field]: ["Choose a file to upload."] });
        if (part.size > def.upload.maxBytes) throw new BadRequestError("The file is too large.", 413);
        file = Buffer.from(await part.arrayBuffer());
        const fields = Object.fromEntries([...form.entries()].filter(([k, v]) => k !== def.upload!.field && typeof v === "string"));
        body = def.body ? parse(def.body, fields, "body") : undefined;
      } else if (def.body) {
        const length = Number(req.headers.get("content-length") ?? 0);
        if (length > MAX_BODY_BYTES) throw new BadRequestError("Request too large.", 413);
        if (!req.headers.get("content-type")?.includes("application/json")) throw new BadRequestError("Send JSON (Content-Type: application/json).", 415);
        const text = await req.text();
        if (text.length > MAX_BODY_BYTES) throw new BadRequestError("Request too large.", 413);
        let raw: unknown;
        try {
          raw = JSON.parse(text || "null");
        } catch {
          throw new BadRequestError("Malformed JSON.");
        }
        body = parse(def.body, raw, "body");
      }

      const result = await handler({ req, meta, auth: auth as AuthFor<E["auth"]>, params: params as In<E["params"]>, query: query as In<E["query"]>, body: body as In<E["body"]>, file: file as MobileHandlerArgs<E>["file"] });
      // Responses go through the contract: unknown fields are stripped, wrong shapes are caught.
      const out = def.response.parse(result);
      return NextResponse.json(out, { status: def.status ?? 200, headers: NO_STORE });
    } catch (error) {
      return errorResponse(error, auth);
    }
  };
}
