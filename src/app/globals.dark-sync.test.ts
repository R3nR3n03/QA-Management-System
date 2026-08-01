import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Dark tokens apply two ways (system preference and the explicit in-app choice) and
// DESIGN-SYSTEM.md requires the two blocks to agree. This turns that sentence into an
// enforced invariant: both DARK-TOKENS blocks must declare the same properties with
// the same values.

const css = readFileSync(path.resolve(__dirname, "globals.css"), "utf8");

function darkBlocks(source: string): string[] {
  const blocks: string[] = [];
  const re = /\/\* DARK-TOKENS-START \*\/([\s\S]*?)\/\* DARK-TOKENS-END \*\//g;
  for (let m = re.exec(source); m; m = re.exec(source)) blocks.push(m[1]);
  return blocks;
}

function declarations(block: string): Map<string, string> {
  const decls = new Map<string, string>();
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    decls.set(m[1], m[2].replace(/\s+/g, " ").trim());
  }
  return decls;
}

describe("dark token blocks", () => {
  const blocks = darkBlocks(css);

  it("finds exactly the two marked blocks", () => {
    expect(blocks).toHaveLength(2);
  });

  it("declares identical tokens with identical values in both blocks", () => {
    const [media, explicit] = blocks.map(declarations);
    expect(Object.fromEntries(explicit)).toEqual(Object.fromEntries(media));
  });

  it("overrides every light token that status ink depends on", () => {
    // --on-status must exist in light and both dark blocks, or danger buttons and
    // badges silently fall back to the light value on one path.
    expect(css).toMatch(/:root\s*{[^}]*--on-status:/);
    for (const block of blocks) {
      expect(declarations(block).has("--on-status")).toBe(true);
    }
  });
});
