import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;

/**
 * Deployment default, not policy: `docs/` defines no password rules, and inventing a
 * complexity policy would be the gap-filling the SSOT rule forbids. A bare floor
 * against empty and trivial passwords is the minimum the credential store can
 * honestly accept. Shared by account creation and self-service change so the two
 * doors cannot drift; the QA Lead should replace it with an approved policy.
 */
export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derivedHex] = stored.split(":");
  if (!salt || !derivedHex) return false;

  const storedBuffer = Buffer.from(derivedHex, "hex");
  const suppliedBuffer = scryptSync(password, salt, KEY_LENGTH);
  if (storedBuffer.length !== suppliedBuffer.length) return false;

  return timingSafeEqual(storedBuffer, suppliedBuffer);
}
