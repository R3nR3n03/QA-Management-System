import { ExecutionOutcome } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildResultComment,
  escapeWikiMarkup,
  MAX_COMMENT_CHARS,
  MAX_FIELD_CHARS,
  MAX_LISTED_CASES,
  type ResultCommentCase,
  type ResultCommentInput
} from "./jira-comment";

const passing = (businessId: string, title: string): ResultCommentCase => ({
  businessId,
  title,
  result: ExecutionOutcome.PASS,
  actualResult: "As expected",
  blockReason: null,
  defectBusinessId: null
});

const run = (over: Partial<ResultCommentInput> = {}): ResultCommentInput => ({
  executionBusinessId: "EXE-0042",
  purpose: "Sprint 24 regression, Chrome",
  testerName: "Renmark Panes",
  result: ExecutionOutcome.PASS,
  finalizedAt: new Date("2026-08-11T14:32:07.000Z"),
  cases: [passing("TC-LOGIN-0001", "Sign in with valid credentials")],
  runUrl: null,
  // What an unconfigured deployment renders, so every assertion below reads as the
  // pre-existing behaviour unless a test deliberately sets a zone (ADR-0007).
  timeZone: "UTC",
  ...over
});

describe("buildResultComment", () => {
  it("reports a clean run as a header and nothing else", () => {
    expect(
      buildResultComment(
        run({
          cases: [
            passing("TC-LOGIN-0001", "Sign in with valid credentials"),
            passing("TC-LOGIN-0002", "Sign out clears the session"),
            passing("TC-LOGIN-0003", "Remember me survives a restart")
          ]
        })
      )
    ).toBe(
      "*QAMS run EXE-0042 — Sprint 24 regression, Chrome*\n" +
        "Result: PASS · 3 cases: 3 passed\n" +
        "Tester: Renmark Panes · Finalized 2026-08-11 14:32 UTC"
    );
  });

  it("counts a single covered case in the singular", () => {
    expect(buildResultComment(run())).toContain("Result: PASS · 1 case: 1 passed");
  });

  // The ORGANIZATION zone, named in the text. No viewer's preference can reach a Jira
  // comment: the reader is not a QAMS user and has none (ADR-0007).
  it("stamps the organization zone, named, when one is configured", () => {
    const body = buildResultComment(run({ timeZone: "Asia/Manila" }));
    expect(body).toContain("Finalized 2026-08-11 22:32 Asia/Manila");
    expect(body).not.toContain("14:32");
  });

  it("lists each failed case with its defect and what actually happened", () => {
    expect(
      buildResultComment(
        run({
          result: ExecutionOutcome.FAIL,
          cases: [
            passing("TC-LOGIN-0001", "Sign in with valid credentials"),
            {
              businessId: "TC-LOGIN-0007",
              title: "Reject expired session token",
              result: ExecutionOutcome.FAIL,
              actualResult: "Session stayed active past expiry",
              blockReason: null,
              defectBusinessId: "BUG-0031"
            }
          ]
        })
      )
    ).toBe(
      "*QAMS run EXE-0042 — Sprint 24 regression, Chrome*\n" +
        "Result: FAIL · 2 cases: 1 passed, 1 failed\n" +
        "Tester: Renmark Panes · Finalized 2026-08-11 14:32 UTC\n" +
        "\n" +
        "*Failed*\n" +
        "* TC-LOGIN-0007 Reject expired session token — BUG-0031 — Session stayed active past expiry"
    );
  });

  // A passing case has nothing to say beyond "it passed", and spelling all of them out is what
  // turns a 200-case regression run into a wall of text nobody reads.
  it("never lists a passing case", () => {
    const body = buildResultComment(
      run({ cases: [passing("TC-LOGIN-0001", "Sign in with valid credentials")] })
    );

    expect(body).not.toContain("TC-LOGIN-0001");
  });

  // A blocked case never ran, so its `actualResult` says nothing; the reason it was blocked is
  // the only useful thing to report.
  it("lists a blocked case under its own heading, with the block reason", () => {
    const body = buildResultComment(
      run({
        result: ExecutionOutcome.BLOCKED,
        cases: [
          {
            businessId: "TC-BILL-0003",
            title: "Invoice PDF renders totals",
            result: ExecutionOutcome.BLOCKED,
            actualResult: "",
            blockReason: "Staging invoice service returned 503",
            defectBusinessId: null
          }
        ]
      })
    );

    expect(body).toContain(
      "*Blocked*\n* TC-BILL-0003 Invoice PDF renders totals — Staging invoice service returned 503"
    );
  });

  it("puts failures before blocked cases", () => {
    const body = buildResultComment(
      run({
        result: ExecutionOutcome.FAIL,
        cases: [
          {
            businessId: "TC-BILL-0003",
            title: "Invoice PDF renders totals",
            result: ExecutionOutcome.BLOCKED,
            actualResult: "",
            blockReason: "Staging invoice service returned 503",
            defectBusinessId: null
          },
          {
            businessId: "TC-LOGIN-0007",
            title: "Reject expired session token",
            result: ExecutionOutcome.FAIL,
            actualResult: "Session stayed active",
            blockReason: null,
            defectBusinessId: null
          }
        ]
      })
    );

    expect(body.indexOf("*Failed*")).toBeLessThan(body.indexOf("*Blocked*"));
  });
});

/**
 * Jira escapes a special character with a leading backslash, so the expected values here are
 * the documented notation rather than anything this module derives.
 */
describe("escapeWikiMarkup", () => {
  // `{code}` opens a block that swallows everything after it, including the sections and the
  // link below — one tester's block reason would eat the rest of the comment.
  it("neutralises a macro that would swallow the rest of the comment", () => {
    expect(escapeWikiMarkup("{code}boom{code}")).toBe("\\{code\\}boom\\{code\\}");
  });

  // The one that matters most: without this, text a tester typed becomes a real link in
  // someone else's ticket, authored by QAMS.
  it("neutralises a link", () => {
    expect(escapeWikiMarkup("[click me|http://elsewhere.example]")).toBe(
      "\\[click me\\|http://elsewhere.example\\]"
    );
  });

  it("neutralises the inline formatting characters", () => {
    expect(escapeWikiMarkup("*bold* _em_ +ins+ -del- ^sup^ ~sub~ !image!")).toBe(
      "\\*bold\\* \\_em\\_ \\+ins\\+ \\-del\\- \\^sup\\^ \\~sub\\~ \\!image\\!"
    );
  });

  // Collapsing newlines is what keeps tester text off the start of a line, where `h1.`, `#`
  // and `bq.` become structural. Every line QAMS emits begins with its own scaffolding.
  it("collapses newlines and runs of whitespace into single spaces", () => {
    expect(escapeWikiMarkup("h1. big\r\n\r\n   then   this  ")).toBe("h1. big then this");
  });

  /**
   * `\\` is Jira's FORCED LINE BREAK, not an escaped backslash — wiki markup has no way to
   * write a literal one. Escaping `\` the way every other special character is escaped would
   * therefore emit a line break, which both alters what the tester wrote and puts the text
   * after it at the start of a line, where `h1.` and `bq.` become structural again.
   */
  it("never emits Jira's line-break token for a backslash a tester typed", () => {
    expect(escapeWikiMarkup("C:\\temp\\notes")).toBe("C:/temp/notes");
    expect(escapeWikiMarkup("C:\\temp\\*")).toBe("C:/temp/\\*");
  });

  it("leaves no backslash that could pair with an escape it added", () => {
    for (const hostile of ["a\\", "\\*", "\\\\", "x\\{code\\}", "C:\\h1. all green"]) {
      expect(escapeWikiMarkup(hostile)).not.toContain("\\\\");
    }
  });
});

describe("buildResultComment with hostile tester text", () => {
  it("escapes every span a tester wrote", () => {
    const body = buildResultComment(
      run({
        purpose: "Sprint 24 | *regression*",
        result: ExecutionOutcome.FAIL,
        cases: [
          {
            businessId: "TC-LOGIN-0007",
            title: "Reject [expired] token",
            result: ExecutionOutcome.FAIL,
            actualResult: "{code}\nstack trace\n{code}",
            blockReason: null,
            defectBusinessId: "BUG-0031"
          }
        ]
      })
    );

    expect(body).toContain("*QAMS run EXE-0042 — Sprint 24 \\| \\*regression\\**");
    expect(body).toContain("* TC-LOGIN-0007 Reject \\[expired\\] token — BUG-0031 — \\{code\\} stack trace \\{code\\}");
  });

  // The scaffolding QAMS writes is the only live markup in the body.
  it("keeps its own formatting live", () => {
    const body = buildResultComment(run({ purpose: "Plain purpose" }));

    expect(body.startsWith("*QAMS run EXE-0042 — Plain purpose*")).toBe(true);
  });
});

const failing = (businessId: string, over: Partial<ResultCommentCase> = {}): ResultCommentCase => ({
  businessId,
  title: "Some behaviour",
  result: ExecutionOutcome.FAIL,
  actualResult: "It did not work",
  blockReason: null,
  defectBusinessId: null,
  ...over
});

describe("buildResultComment caps", () => {
  // Jira caps a comment at 32,767 characters, and `actualResult` is an unbounded column -- a
  // tester pasting a stack trace would otherwise put the whole thing in someone's ticket.
  it("truncates a free-text field that runs long", () => {
    const body = buildResultComment(
      run({
        result: ExecutionOutcome.FAIL,
        cases: [failing("TC-A-0001", { actualResult: "z".repeat(MAX_FIELD_CHARS + 50) })]
      })
    );

    expect(body).toContain(`— ${"z".repeat(MAX_FIELD_CHARS)}…`);
    expect(body).not.toContain("z".repeat(MAX_FIELD_CHARS + 1));
  });

  it("leaves a field that fits exactly alone", () => {
    const body = buildResultComment(
      run({
        result: ExecutionOutcome.FAIL,
        cases: [failing("TC-A-0001", { actualResult: "z".repeat(MAX_FIELD_CHARS) })]
      })
    );

    expect(body).toContain(`— ${"z".repeat(MAX_FIELD_CHARS)}`);
    expect(body).not.toContain("…");
  });

  it("lists only the first cases and says how many it left out", () => {
    const cases = Array.from({ length: MAX_LISTED_CASES + 7 }, (_, index) =>
      failing(`TC-A-${String(index).padStart(4, "0")}`)
    );

    const body = buildResultComment(run({ result: ExecutionOutcome.FAIL, cases }));

    expect(body).toContain("TC-A-0049");
    expect(body).not.toContain("TC-A-0050");
    expect(body).toContain("…and 7 more, see QAMS");
  });

  // Truncating the LIST must not touch the tallies: the header is the one place that still
  // tells the whole truth about the run.
  it("counts every case in the header even when the list is truncated", () => {
    const cases = Array.from({ length: MAX_LISTED_CASES + 7 }, (_, index) =>
      failing(`TC-A-${String(index).padStart(4, "0")}`)
    );

    expect(buildResultComment(run({ result: ExecutionOutcome.FAIL, cases }))).toContain(
      `${MAX_LISTED_CASES + 7} cases: ${MAX_LISTED_CASES + 7} failed`
    );
  });

  it("links back to the run when a base URL is configured", () => {
    const body = buildResultComment(run({ runUrl: "https://qams.example.com/executions/abc-123" }));

    expect(body.endsWith("\n\n[Full results in QAMS|https://qams.example.com/executions/abc-123]")).toBe(true);
  });

  // No APP_BASE_URL means there is nowhere to send a reader. A guessed origin would render a
  // link that looks authoritative and goes nowhere.
  it("omits the link entirely when there is no base URL", () => {
    const body = buildResultComment(run({ runUrl: null }));

    expect(body).not.toContain("Full results");
    expect(body).not.toContain("[");
  });

  /**
   * The per-field and per-case caps bound what a READER sees. They do not bound what is sent:
   * escaping nearly doubles a field of pathological input, so the documented limits alone
   * still allow a body past the 32,767 characters Jira accepts — and a comment Jira refuses
   * outright is the one failure that produces nothing at all.
   */
  it("stays within Jira's limit even when every character escapes", () => {
    const hostile = "{".repeat(MAX_FIELD_CHARS);
    const cases = Array.from({ length: MAX_LISTED_CASES }, (_, index) =>
      failing(`TC-A-${String(index).padStart(4, "0")}`, { title: hostile, actualResult: hostile })
    );

    const body = buildResultComment(run({ result: ExecutionOutcome.FAIL, cases }));

    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS);
    expect(body).toContain("more, see QAMS");
  });

  it("says nothing about omissions when everything fits", () => {
    expect(buildResultComment(run({ result: ExecutionOutcome.FAIL, cases: [failing("TC-A-0001")] }))).not.toContain(
      "more, see QAMS"
    );
  });
});
