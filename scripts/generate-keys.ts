/**
 * Prints fresh secrets for .env. Nothing is written to disk or logged elsewhere.
 *   npm run keys:generate
 *   npm run keys:generate -- --encryption-version 2   (a new key to append for rotation)
 */
import { randomBytes } from "node:crypto";

const versionFlag = process.argv.indexOf("--encryption-version");
const version = versionFlag > -1 ? Number(process.argv[versionFlag + 1]) : 1;
if (!Number.isInteger(version) || version < 1) {
  console.error("--encryption-version must be a positive integer");
  process.exit(1);
}

const b64 = (bytes: number) => randomBytes(bytes).toString("base64");

if (versionFlag > -1) {
  console.log(`# Append to ENCRYPTION_KEYS (comma-separated), then set ENCRYPTION_ACTIVE_KEY_VERSION=${version}`);
  console.log(`${version}:${b64(32)}`);
} else {
  console.log("# Paste into .env — keep these secret and back them up securely.");
  console.log("# Losing ENCRYPTION_KEYS makes encrypted personal data unrecoverable.");
  console.log(`AUTH_SECRET=${b64(48)}`);
  console.log(`ENCRYPTION_KEYS=1:${b64(32)}`);
  console.log("ENCRYPTION_ACTIVE_KEY_VERSION=1");
  console.log(`BLIND_INDEX_KEY=${b64(32)}`);
  console.log("BLIND_INDEX_KEY_VERSION=1");
  console.log(`APP_DB_PASSWORD=${randomBytes(18).toString("base64url")}`);
}
