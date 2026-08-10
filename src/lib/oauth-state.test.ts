import { describe, expect, it } from "vitest";
import { createOAuthState, parseOAuthState, verifyOAuthState } from "./oauth-state";

const SECRET = "test-signing-secret";
const NOW = 1_760_000_000_000;

describe("createOAuthState / verifyOAuthState", () => {
  it("round-trips the user it was issued to", () => {
    const state = createOAuthState("user-1", SECRET, NOW);
    expect(verifyOAuthState(state, SECRET, NOW + 1000)?.userId).toBe("user-1");
  });

  // The whole point of `state`: an attacker who can make the victim's browser hit the
  // callback must not be able to forge one, or they can bind THEIR Jira account to the
  // victim's QAMS user.
  it("rejects a forged signature", () => {
    const state = createOAuthState("user-1", SECRET, NOW);
    const parts = state.split(".");
    parts[parts.length - 1] = "0".repeat(64);
    expect(verifyOAuthState(parts.join("."), SECRET, NOW)).toBeNull();
  });

  it("rejects a state signed with another secret", () => {
    expect(verifyOAuthState(createOAuthState("user-1", "other", NOW), SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered user id", () => {
    const state = createOAuthState("user-1", SECRET, NOW);
    const parsed = parseOAuthState(state);
    const forged = `${parsed!.nonce}.user-2.${parsed!.issuedAt}.${state.split(".").pop()}`;
    expect(verifyOAuthState(forged, SECRET, NOW)).toBeNull();
  });

  it.each([["nonsense"], [""], ["a.b.c"]])("rejects the malformed state %s", (raw) => {
    expect(verifyOAuthState(raw, SECRET, NOW)).toBeNull();
  });

  // A state that never expires is a replay waiting to happen; the consent round trip takes
  // seconds, not hours.
  it("rejects a state older than its lifetime", () => {
    const state = createOAuthState("user-1", SECRET, NOW);
    expect(verifyOAuthState(state, SECRET, NOW + 11 * 60 * 1000)).toBeNull();
  });

  it("accepts a state still inside its lifetime", () => {
    const state = createOAuthState("user-1", SECRET, NOW);
    expect(verifyOAuthState(state, SECRET, NOW + 5 * 60 * 1000)).not.toBeNull();
  });

  it("rejects a state issued in the future", () => {
    const state = createOAuthState("user-1", SECRET, NOW + 60_000);
    expect(verifyOAuthState(state, SECRET, NOW)).toBeNull();
  });

  // Two Connect clicks must not produce the same value, or one could be replayed for the
  // other.
  it("issues a distinct state each time", () => {
    expect(createOAuthState("user-1", SECRET, NOW)).not.toBe(createOAuthState("user-1", SECRET, NOW));
  });

  it("is URL-safe, since it travels as a query parameter", () => {
    const state = createOAuthState("user-1", SECRET, NOW);
    expect(encodeURIComponent(state)).toBe(state);
  });
});
