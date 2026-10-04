import "server-only";
import argon2 from "argon2";

// OWASP's argon2id minimum configuration (19 MiB, 2 passes, 1 lane).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/** True only for a matching password. A malformed hash is just "no match", never a throw. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns one verify of the same cost as a real one. Login calls this when the
 * email is unknown so that "no such user" takes as long as "wrong password"
 * and response time does not reveal which emails are registered.
 */
export async function verifyAgainstDummy(plain: string): Promise<void> {
  try {
    // Built lazily (not at import) so module load stays cheap; random so the
    // plaintext is not a constant an attacker could target.
    dummyHash ??= hashPassword(crypto.randomUUID());
    await argon2.verify(await dummyHash, plain);
  } catch {
    // Timing equalizer only: its outcome is irrelevant and must never surface.
  }
}
