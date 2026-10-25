/**
 * Write the mobile API's OpenAPI document (generated from the shared contract) to
 * packages/shared/openapi.json. The running app also serves it at /api/mobile/v1/openapi.json.
 *   npm run openapi:generate
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildOpenApiDocument } from "../packages/shared/src/api/openapi";

const out = path.join("packages", "shared", "openapi.json");
const doc = buildOpenApiDocument();
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`✔ ${Object.keys(doc.paths).length} paths written to ${out}`);
