import { describe, expect, it } from "vitest";
import { ensureStepSequence } from "./validation";

describe("ensureStepSequence", () => {
  it("accepts consecutive 1..n sequence", () => {
    expect(() => ensureStepSequence([{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }])).not.toThrow();
  });

  it("rejects gaps", () => {
    expect(() => ensureStepSequence([{ sequence: 1 }, { sequence: 3 }])).toThrow();
  });
});
