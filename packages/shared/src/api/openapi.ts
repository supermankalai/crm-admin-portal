import { z } from "zod";
import { api, MOBILE_API_BASE, type Endpoint } from "./contract";
import { apiErrorSchema } from "./schemas";

/** OpenAPI 3.1 document for the mobile API, generated from the contract's Zod schemas. */

const json = (schema: z.ZodType, io: "input" | "output") => z.toJSONSchema(schema, { io, unrepresentable: "any" });

const ERROR_RESPONSES = {
  "400": "Malformed request",
  "401": "Missing, invalid or expired access token",
  "402": "Not included in the gym's plan, or a plan limit was reached",
  "403": "Not allowed for your role",
  "404": "Not found (also for other gyms' data)",
  "409": "Conflict, or the gym is read-only",
  "422": "Validation failed (see fieldErrors)",
  "429": "Too many attempts (see Retry-After)",
} as const;

function multipartSchema(def: Endpoint) {
  const fields = def.body ? (json(def.body, "input") as { properties?: Record<string, unknown>; required?: string[] }) : {};
  return {
    type: "object",
    properties: { ...(fields.properties ?? {}), [def.upload!.field]: { type: "string", format: "binary", maxLength: def.upload!.maxBytes } },
    required: [...(fields.required ?? []), def.upload!.field],
  };
}

export function buildOpenApiDocument(serverUrl = "") {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [operationId, def] of Object.entries(api) as [string, Endpoint][]) {
    const path = `${MOBILE_API_BASE}${def.path}`;
    const parameters = [
      ...Object.keys(def.params?.shape ?? {}).map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
      ...Object.entries(def.query?.shape ?? {}).map(([name, schema]) => ({ name, in: "query", required: !(schema as z.ZodType).safeParse(undefined).success, schema: json(schema as z.ZodType, "input") })),
    ];
    const responses: Record<string, unknown> = {
      [String(def.status ?? 200)]: { description: "Success", content: { "application/json": { schema: json(def.response, "output") } } },
    };
    for (const [code, description] of Object.entries(ERROR_RESPONSES)) {
      if (def.auth === "none" && (code === "401" || code === "403")) continue;
      responses[code] = { description, content: { "application/json": { schema: json(apiErrorSchema, "output") } } };
    }
    paths[path] ??= {};
    paths[path][def.method.toLowerCase()] = {
      operationId,
      summary: def.summary,
      tags: [def.tag],
      security: def.auth === "none" ? [] : [{ bearerAuth: [] }],
      ...(parameters.length ? { parameters } : {}),
      ...(def.upload
        ? { requestBody: { required: true, content: { "multipart/form-data": { schema: multipartSchema(def) } } } }
        : def.body
          ? { requestBody: { required: true, content: { "application/json": { schema: json(def.body, "input") } } } }
          : {}),
      responses,
      "x-auth": def.auth,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "FitCRM Mobile API",
      version: "1.0.0",
      description:
        "Versioned API for the FitCRM mobile app. Access tokens last 15 minutes; refresh tokens rotate and reusing one revokes the device session. The gym always comes from the verified token, never from the request.",
    },
    servers: serverUrl ? [{ url: serverUrl }] : [],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
    paths,
  };
}
