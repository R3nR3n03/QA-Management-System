import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Authenticated encryption for secrets held at rest.
 *
 * Built for `JiraCredential.encryptedRefreshToken` — the first third-party secret QAMS
 * stores. Until now the only secret at rest was a password hash, which is a one-way digest
 * and needs none of this; a refresh token has to come back out again, so it needs real
 * encryption rather than hashing (`docs/api-and-security.md#Authorization and security`).
 *
 * ## AES-256-GCM, not CBC or a bare cipher
 *
 * GCM is *authenticated*: tampering fails loudly at `final()` instead of decrypting to
 * rubbish. That matters more than usual here, because the plaintext is a credential that
 * would otherwise be sent to Jira — silently decrypting garbage would produce a confusing
 * auth failure against a third party rather than an obvious local error.
 *
 * ## A random IV per call, never a fixed one
 *
 * Reusing an IV under one key is the classic way to break GCM outright. It would also mean
 * two users holding the same token produced identical ciphertext, so the column itself would
 * leak which accounts match. The IV is not secret and travels with the value.
 *
 * ## Envelope format
 *
 * `v1.<iv>.<ciphertext+tag>`, both base64. The version prefix is what makes a future key
 * rotation or algorithm change decodable rather than a guess about what old rows contain.
 *
 * Pure apart from `randomBytes`, and the key is injected, so this is testable without any
 * environment at all.
 */

/** AES-256 needs exactly this many bytes of key. */
const KEY_BYTES = 32;

/** 96 bits, the size GCM is specified for. */
const IV_BYTES = 12;

const VERSION = "v1";

/**
 * Validates and decodes the configured key.
 *
 * Throws rather than falling back, deliberately and unlike the tunables in `rate-limit.ts`:
 * there is no safe default for an encryption key. A generated one would silently make every
 * stored credential undecryptable on the next restart.
 *
 * Generate with `openssl rand -base64 32`.
 */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "An encryption key is not configured. Generate one with `openssl rand -base64 32`."
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new Error("The encryption key must be base64.");
  }

  // Buffer.from is lenient with invalid base64 and silently truncates, so the length check
  // below is what actually rejects a malformed key rather than the try/catch above.
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `The encryption key must decode to ${KEY_BYTES} bytes; got ${key.length}. Generate one with \`openssl rand -base64 32\`.`
    );
  }

  return key;
}

/** Seals a value. The result is safe to store, and carries its own IV and auth tag. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  // The tag is appended rather than stored separately: it is meaningless without the body,
  // and one field is one fewer thing a caller can lose.
  const sealed = Buffer.concat([body, cipher.getAuthTag()]);
  return `${VERSION}.${iv.toString("base64")}.${sealed.toString("base64")}`;
}

/**
 * Opens a sealed value.
 *
 * Throws on a wrong key, a tampered value, or a malformed envelope — all of which mean the
 * stored credential cannot be trusted, and none of which should be recoverable into
 * "probably fine".
 */
export function decryptSecret(sealed: string, key: Buffer): string {
  const parts = sealed.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error("Malformed encrypted value.");
  }

  const iv = Buffer.from(parts[1], "base64");
  const body = Buffer.from(parts[2], "base64");
  if (iv.length !== IV_BYTES || body.length < 16) {
    throw new Error("Malformed encrypted value.");
  }

  // The last 16 bytes are GCM's auth tag; the rest is ciphertext.
  const tag = body.subarray(body.length - 16);
  const ciphertext = body.subarray(0, body.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  // `final()` is where authentication is checked, so a tampered value throws here.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
