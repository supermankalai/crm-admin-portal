import { hash, verify } from "@node-rs/argon2";

/**
 * argon2id with the OWASP baseline parameters (m=19 MiB, t=2, p=1).
 * @node-rs/argon2 defaults to the argon2id algorithm.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verified against when the email is unknown, so response time does not reveal whether
// an account exists.
let dummyHash: Promise<string> | undefined;

export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("dummy-password-for-timing-equalisation");
  await verifyPassword(await dummyHash, password);
  return false;
}
