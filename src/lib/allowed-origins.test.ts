import { describe, expect, it } from "vitest";
import { allowedOrigins, parseAllowedOrigins, serverActionsConfig } from "./allowed-origins";

describe("parseAllowedOrigins", () => {
  it("splits a comma-separated list and trims each entry", () => {
    expect(parseAllowedOrigins("qams.example.com")).toEqual(["qams.example.com"]);
    expect(parseAllowedOrigins("qams.example.com, qams.internal:3000")).toEqual([
      "qams.example.com",
      "qams.internal:3000"
    ]);
  });

  it("drops blank entries and collapses duplicates", () => {
    expect(parseAllowedOrigins("a.example.com,,  , a.example.com , b.example.com")).toEqual([
      "a.example.com",
      "b.example.com"
    ]);
  });

  it("returns an empty list for anything unset or blank", () => {
    for (const bad of [undefined, "", "   ", ",", " , , "]) {
      expect(parseAllowedOrigins(bad)).toEqual([]);
    }
  });

  it("reads ALLOWED_ORIGINS from the supplied environment", () => {
    expect(allowedOrigins({ ALLOWED_ORIGINS: "qams.example.com" })).toEqual(["qams.example.com"]);
    expect(allowedOrigins({})).toEqual([]);
  });
});

describe("serverActionsConfig", () => {
  it("returns the allowlist when one is configured", () => {
    expect(serverActionsConfig({ ALLOWED_ORIGINS: "qams.example.com" })).toEqual({
      allowedOrigins: ["qams.example.com"]
    });
  });

  /**
   * Undefined, not `{ allowedOrigins: [] }`. Omitting the key leaves Next's default
   * same-origin check untouched; supplying an empty allowlist is a configuration statement
   * whose meaning belongs to Next and could shift between versions. The safe default must
   * be "say nothing".
   */
  it("returns undefined when nothing is configured, so the key can be omitted", () => {
    expect(serverActionsConfig({})).toBeUndefined();
    expect(serverActionsConfig({ ALLOWED_ORIGINS: "   " })).toBeUndefined();
  });
});
