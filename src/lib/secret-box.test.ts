import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "./secret-box";

// 32 bytes, base64 — what `openssl rand -base64 32` produces.
const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("parseEncryptionKey", () => {
  it("accepts a 32-byte base64 key", () => {
    expect(parseEncryptionKey(KEY)).toHaveLength(32);
  });

  it.each<[string | undefined, string]>([
    [undefined, "absent"],
    ["", "blank"],
    [Buffer.alloc(16, 1).toString("base64"), "16 bytes"],
    [Buffer.alloc(64, 1).toString("base64"), "64 bytes"],
    ["not base64 !!!", "not base64"]
  ])("refuses a key that is %s (%s)", (raw) => {
    expect(() => parseEncryptionKey(raw)).toThrow();
  });
});

describe("encryptSecret / decryptSecret", () => {
  const key = parseEncryptionKey(KEY);

  it("round-trips a value", () => {
    expect(decryptSecret(encryptSecret("refresh-token-abc", key), key)).toBe("refresh-token-abc");
  });

  it("round-trips unicode and empty input", () => {
    expect(decryptSecret(encryptSecret("tökén-✓", key), key)).toBe("tökén-✓");
    expect(decryptSecret(encryptSecret("", key), key)).toBe("");
  });

  // Without a random IV, the same token would produce identical ciphertext for every user,
  // so the column would leak which accounts share a value.
  it("produces different ciphertext each time for the same input", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("never contains the plaintext", () => {
    expect(encryptSecret("refresh-token-abc", key)).not.toContain("refresh-token-abc");
  });

  it("cannot be decrypted with a different key", () => {
    const sealed = encryptSecret("secret", key);
    expect(() => decryptSecret(sealed, parseEncryptionKey(OTHER_KEY))).toThrow();
  });

  // GCM is authenticated: a tampered ciphertext must fail loudly rather than decrypt to
  // rubbish that then gets sent to Jira as a credential.
  it("refuses tampered ciphertext", () => {
    const sealed = encryptSecret("secret", key);
    const parts = sealed.split(".");
    const body = Buffer.from(parts[2], "base64");
    body[0] ^= 0xff;
    parts[2] = body.toString("base64");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("refuses a malformed envelope", () => {
    expect(() => decryptSecret("nonsense", key)).toThrow();
    expect(() => decryptSecret("a.b", key)).toThrow();
  });
});
