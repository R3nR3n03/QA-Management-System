import { describe, expect, it } from "vitest";
import { SHARED_CLIENT_KEY, clientKey, emailKey, parseForwardedFor } from "./client-key";

/** SHA-256 of "user@example.com", computed once and pinned. */
const USER_AT_EXAMPLE =
  "email:b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514";

describe("parseForwardedFor", () => {
  it("takes the first hop, which is the original client", () => {
    expect(parseForwardedFor("203.0.113.5")).toBe("203.0.113.5");
    expect(parseForwardedFor("203.0.113.5, 198.51.100.9, 10.0.0.1")).toBe("203.0.113.5");
    expect(parseForwardedFor("  203.0.113.5  ,198.51.100.9")).toBe("203.0.113.5");
  });

  it("returns null when there is nothing usable to key on", () => {
    for (const bad of [null, undefined, "", "   ", ",", " , ,"]) {
      expect(parseForwardedFor(bad)).toBeNull();
    }
  });
});

describe("clientKey", () => {
  function headers(values: Record<string, string>) {
    return { get: (name: string) => values[name] ?? null };
  }

  it("prefers x-forwarded-for", () => {
    expect(clientKey(headers({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "10.0.0.1" }))).toBe(
      "client:203.0.113.5"
    );
  });

  it("falls back to x-real-ip", () => {
    expect(clientKey(headers({ "x-real-ip": " 10.0.0.1 " }))).toBe("client:10.0.0.1");
  });

  /**
   * Restrictive direction: an unidentifiable caller shares one bucket rather than getting
   * a private allowance for sending no headers. This is the exception rather than the rule
   * — Next backfills x-forwarded-for from the socket peer address, so a real caller under
   * `next start` normally has its own bucket. See the note in client-key.ts.
   */
  it("falls back to one shared bucket, never to a private one", () => {
    expect(clientKey(headers({}))).toBe(SHARED_CLIENT_KEY);
    expect(clientKey(headers({ "x-forwarded-for": "  ", "x-real-ip": "" }))).toBe(
      SHARED_CLIENT_KEY
    );
  });
});

describe("emailKey", () => {
  it("hashes the address so no account list is held in process memory", () => {
    expect(emailKey("user@example.com")).toBe(USER_AT_EXAMPLE);
    expect(emailKey("user@example.com")).not.toContain("user@example.com");
  });

  it("normalises case and surrounding whitespace to one bucket per account", () => {
    expect(emailKey("  User@Example.COM  ")).toBe(USER_AT_EXAMPLE);
  });

  it("keeps different accounts in different buckets", () => {
    expect(emailKey("a@example.com")).not.toBe(emailKey("b@example.com"));
  });
});
