import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.2 AA contrast, enforced against the real stylesheet.
 *
 * `DESIGN-SYSTEM.md` claims the palette is accessible; this decides it. The token
 * values are read out of `globals.css` rather than restated here, so the test fails
 * when someone retunes a colour rather than when someone forgets to update a fixture.
 *
 * Two thresholds, per the spec:
 *
 * - **4.5:1 — SC 1.4.3 (Contrast Minimum)** for body-size text. Large text (>=18.66px,
 *   or >=14px bold) may drop to 3:1, which the `large` flag marks.
 * - **3:1 — SC 1.4.11 (Non-text Contrast)** for the boundary of an interactive
 *   control. A form control here is filled with `--surface`, the same colour as the
 *   card behind it, so its border is the ONLY thing marking where the control is.
 *
 * Structural rules (`--line` on a card edge, `--line-soft` between rows) are
 * deliberately absent: they are decoration a reader may ignore, not the identity of a
 * control, and 1.4.11 does not reach them. That distinction is exactly why
 * `--line-strong` exists as its own token.
 *
 * Disabled controls are also absent — 1.4.3 and 1.4.11 both exempt inactive components.
 */

const css = readFileSync(path.resolve(__dirname, "globals.css"), "utf8");

/** The light palette is the `:root {}` block; the dark one is either DARK-TOKENS block. */
function lightTokens(): Map<string, string> {
  const root = /:root\s*{([\s\S]*?)}/.exec(css);
  if (!root) throw new Error("no :root block in globals.css");
  return declarations(root[1]);
}

function darkTokens(): Map<string, string> {
  const block = /\/\* DARK-TOKENS-START \*\/([\s\S]*?)\/\* DARK-TOKENS-END \*\//.exec(css);
  if (!block) throw new Error("no DARK-TOKENS block in globals.css");
  // Dark overrides light: a token the dark block does not restate keeps its light value.
  return new Map([...lightTokens(), ...declarations(block[1])]);
}

function declarations(block: string): Map<string, string> {
  const decls = new Map<string, string>();
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  for (let m = re.exec(block); m; m = re.exec(block)) decls.set(m[1], m[2].trim());
  return decls;
}

function channels(hex: string): [number, number, number] {
  const s = hex.replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(s)) throw new Error(`not a 6-digit hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance, per WCAG 2.x. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Pair = {
  fg: string;
  bg: string;
  /** Where this combination actually renders — so a failure names the screen, not a hex. */
  where: string;
  /** SC 1.4.3 large-text allowance: >=18.66px, or >=14px at weight >=700. */
  large?: boolean;
  /** SC 1.4.11: a control boundary rather than text. */
  nonText?: boolean;
};

/** Text pairs that must clear 4.5:1 (or 3:1 when marked large). */
const TEXT: Pair[] = [
  { fg: "--ink", bg: "--surface", where: "body text on a card" },
  { fg: "--ink", bg: "--paper", where: "body text on the page" },
  { fg: "--ink-2", bg: "--surface", where: ".field label, .notice span" },
  { fg: "--ink-2", bg: "--paper", where: "paragraph copy on the page" },
  { fg: "--ink-2", bg: "--surface-2", where: ".nav-link label, .stepper done" },
  { fg: "--ink-2", bg: "--accent-wash", where: ".list-row:hover body text" },
  { fg: "--ink-2", bg: "--blocked-wash", where: ".why callout body" },
  { fg: "--ink-2", bg: "--fail-wash", where: ".notice span (error copy)" },
  { fg: "--ink-3", bg: "--surface", where: ".muted, .hint, .kpi-label" },
  { fg: "--ink-3", bg: "--paper", where: ".empty p, .crumbs a" },
  { fg: "--ink-3", bg: "--surface-2", where: ".state chip, .rail-heading, .rail-role" },
  { fg: "--ink-3", bg: "--accent-wash", where: ".list-row:hover .muted" },
  { fg: "--accent", bg: "--surface", where: "links, .btn-ghost" },
  { fg: "--accent", bg: "--paper", where: "a link on the page background" },
  { fg: "--accent", bg: "--surface-2", where: ".rail-brand" },
  { fg: "--accent", bg: "--accent-wash", where: ".state-review, .stepper current" },
  { fg: "--on-accent", bg: "--accent", where: ".btn primary, .nav-link[aria-current]" },
  { fg: "--on-status", bg: "--fail", where: ".btn-danger, .nav-badge" },
  // The graded marks. These are the most-read things in the product.
  { fg: "--pass", bg: "--pass-wash", where: ".state-pass chip" },
  { fg: "--fail", bg: "--fail-wash", where: ".state-fail chip" },
  { fg: "--blocked", bg: "--blocked-wash", where: ".state-blocked chip" },
  // Status ink also renders bare on a card, without its wash behind it: the graded
  // tallies in an execution's result summary. Held to 4.5:1 like any other number a
  // reader is expected to read, not to the 3:1 the 21px value would be allowed.
  { fg: "--pass", bg: "--surface", where: ".run-stat-pass dd" },
  { fg: "--fail", bg: "--surface", where: ".run-stat-fail dd" },
  { fg: "--blocked", bg: "--surface", where: ".run-stat-blocked dd" },
  // And bare on the inset surface: the check batch head's tally slots sit in a
  // `--surface-2` trough (`.tally-slot`) and tone their value the same way. Held to
  // 4.5:1 rather than the 3:1 the 20px value would be allowed, for the same reason.
  { fg: "--pass", bg: "--surface-2", where: ".tally-slot[data-tone=pass] .tally-n" },
  { fg: "--fail", bg: "--surface-2", where: ".tally-slot[data-tone=fail] .tally-n" },
  { fg: "--blocked", bg: "--surface-2", where: ".tally-slot[data-tone=blocked] .tally-n" },
  { fg: "--ink", bg: "--fail-wash", where: ".notice strong", large: true }
];

/** Control boundaries and meaningful fills: SC 1.4.11, 3:1. */
const NON_TEXT: Pair[] = [
  { fg: "--line-strong", bg: "--surface", where: "input/select/outlined-button edge on a card", nonText: true },
  { fg: "--line-strong", bg: "--paper", where: "control edge against the page", nonText: true },
  { fg: "--line-strong", bg: "--surface-2", where: ".rail-search edge on the rail", nonText: true },
  { fg: "--accent", bg: "--paper", where: ":focus-visible ring on the page", nonText: true },
  { fg: "--accent", bg: "--surface", where: ":focus-visible ring on a card", nonText: true },
  { fg: "--accent", bg: "--surface-2", where: ":focus-visible ring on the rail", nonText: true },
  { fg: "--accent-2", bg: "--surface", where: "focused input border", nonText: true },
  { fg: "--accent", bg: "--surface-2", where: ".progress-fill against its track", nonText: true },
  { fg: "--fail", bg: "--surface", where: ".field-bad border on a card", nonText: true }
];

function required(pair: Pair): number {
  if (pair.nonText) return 3;
  return pair.large ? 3 : 4.5;
}

for (const [theme, tokens] of [
  ["light", lightTokens()],
  ["dark", darkTokens()]
] as const) {
  describe(`${theme} theme contrast`, () => {
    it.each([...TEXT, ...NON_TEXT])(
      `$fg on $bg clears AA — $where`,
      (pair) => {
        const fg = tokens.get(pair.fg);
        const bg = tokens.get(pair.bg);
        expect(fg, `${pair.fg} is not defined in the ${theme} palette`).toBeDefined();
        expect(bg, `${pair.bg} is not defined in the ${theme} palette`).toBeDefined();

        const measured = contrast(fg as string, bg as string);
        const floor = required(pair);
        // Reported to 2dp so a failure states the shortfall rather than just "false".
        expect(
          Number(measured.toFixed(2)),
          `${pair.fg} (${fg}) on ${pair.bg} (${bg}) is ${measured.toFixed(2)}:1, needs ${floor}:1 — ${pair.where}`
        ).toBeGreaterThanOrEqual(floor);
      }
    );
  });
}

/**
 * The contrast assertions above only prove the token VALUE is sound. A token nothing
 * references would let them all pass while every control on screen still drew its edge
 * with the 1.37:1 `--line`. These check the wiring.
 */
describe("the control-boundary token is wired to the controls", () => {
  /**
   * The declaration body of the first rule whose selector list contains `selector`.
   *
   * Comments are stripped first — several of these rules are preceded by a prose block,
   * which would otherwise be swallowed into the selector text. Splitting the selector on
   * commas AND newlines matches this stylesheet's convention of one selector per line.
   */
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  function ruleBody(selector: string): string {
    const re = /([^{}]+){([^{}]*)}/g;
    for (let m = re.exec(withoutComments); m; m = re.exec(withoutComments)) {
      const selectors = m[1].split(/[,\n]/).map((s) => s.trim());
      if (selectors.includes(selector)) return m[2];
    }
    throw new Error(`no rule found for selector: ${selector}`);
  }

  // Every interactive control whose fill matches the surface behind it, so its border
  // is the only thing marking where it begins.
  it.each([
    [".field input", "text, textarea and select inputs"],
    [".btn-secondary", "the outlined button"],
    [".select-filter", "the list dropdown filter"],
    [".dropzone", "the automation results drop target"],
    [".list-toolbar", "the list search field"],
    [".rail-search", "the sidebar search field"],
    [".case-pick", "a case row that opens its result dialog"],
    [".outcome-choice", "a Pass/Fail/Blocked radio card"],
    [".pick-list", "the scrollable multi-select frame"]
  ])("%s draws its border with --line-strong (%s)", (selector) => {
    expect(ruleBody(selector)).toMatch(/border(?:-color)?:[^;]*var\(--line-strong\)/);
  });

  it("defines --line-strong in the light palette and both dark blocks", () => {
    // Missing from a dark block and the control edges silently keep the light value,
    // which is near-invisible on a dark surface.
    expect(lightTokens().has("--line-strong")).toBe(true);
    const darkBlocks = css.match(/\/\* DARK-TOKENS-START \*\/[\s\S]*?\/\* DARK-TOKENS-END \*\//g) ?? [];
    expect(darkBlocks).toHaveLength(2);
    for (const block of darkBlocks) expect(block).toMatch(/--line-strong\s*:/);
  });
});
