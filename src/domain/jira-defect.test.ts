import { DefectLifecycleState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  buildDefectIssueFields,
  buildDefectLifecycleComment,
  MAX_DEFECT_FIELD_CHARS,
  MAX_SUMMARY_CHARS,
  normalizeJiraProjectKey,
  qamsDefectLabel,
  shouldTransitionDefectIssue,
  type DefectIssueInput
} from "./jira-defect";

const defect: DefectIssueInput = {
  defectBusinessId: "BUG-0001",
  summary: "Checkout total excludes VAT",
  priority: "High",
  severity: "Major",
  testCaseBusinessId: "TC-CHECKOUT-0007",
  testCaseTitle: "Cart totals include tax",
  reporterName: "Renmark Panes",
  defectUrl: "https://qams.example.com/defects/abc"
};

describe("qamsDefectLabel", () => {
  it("prefixes the defect business ID", () => {
    expect(qamsDefectLabel("BUG-0001")).toBe("qams-BUG-0001");
  });
});

describe("normalizeJiraProjectKey", () => {
  it("accepts a well-formed key", () => {
    expect(normalizeJiraProjectKey("SP")).toBe("SP");
    expect(normalizeJiraProjectKey("AFS")).toBe("AFS");
    expect(normalizeJiraProjectKey("D1")).toBe("D1");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeJiraProjectKey("  SP  ")).toBe("SP");
  });

  /**
   * Upper-cased rather than refused. This is a form field a QA Lead types, not a deployment
   * variable edited once beneath an explanatory comment — `sp` has one obvious intention.
   */
  it("upper-cases what someone typed in lower case", () => {
    expect(normalizeJiraProjectKey("sp")).toBe("SP");
  });

  /**
   * Absence is the default for a product and means "raise nothing". Blank is a field someone
   * cleared, which means the same — and clearing it is how the sync is switched off for a
   * product, so it must never be an error.
   */
  it.each([[null], [undefined], [""], ["   "]])("resolves %s to null rather than failing", (raw) => {
    expect(normalizeJiraProjectKey(raw as string | null | undefined)).toBeNull();
  });

  it.each([["S"], ["SP-1"], ["MY PROJECT"], ["1SP"], ["SP_1"]])(
    "refuses the malformed key %s",
    (raw) => {
      expect(() => normalizeJiraProjectKey(raw)).toThrowError(AppError);
    }
  );

  it("names the field on the error, so a form can highlight it", () => {
    try {
      normalizeJiraProjectKey("SP-1");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as AppError).field).toBe("jiraProjectKey");
      expect((error as AppError).status).toBe(422);
    }
  });

  /**
   * Shape only. Verifying the project exists would mean calling Jira while editing the
   * catalogue, which would let a Jira outage block a QA Lead from renaming a product — the
   * same coupling `normalizeJiraIssueKey` refuses at planning time.
   */
  it("accepts a well-formed key naming a project that may not exist", () => {
    expect(normalizeJiraProjectKey("NOSUCHPROJECT")).toBe("NOSUCHPROJECT");
  });
});

describe("buildDefectIssueFields", () => {
  it("puts the QAMS defect ID in front of the summary, so a board reads it without opening", () => {
    expect(buildDefectIssueFields(defect).summary).toBe("BUG-0001 Checkout total excludes VAT");
  });

  it("labels the issue so a retry can recognise it instead of raising a duplicate", () => {
    expect(buildDefectIssueFields(defect).labels).toEqual(["qams-BUG-0001"]);
  });

  it("states priority and severity in the description rather than as Jira fields", () => {
    const { description } = buildDefectIssueFields(defect);
    expect(description).toContain("*Priority:* High");
    expect(description).toContain("*Severity:* Major");
  });

  // An unset controlled value must read as unset, not as a formatting accident.
  it("renders an absent priority or severity as 'not set'", () => {
    const { description } = buildDefectIssueFields({ ...defect, priority: "", severity: "   " });
    expect(description).toContain("*Priority:* not set");
    expect(description).toContain("*Severity:* not set");
  });

  it("links back to QAMS, which stays the system of record", () => {
    expect(buildDefectIssueFields(defect).description).toContain(
      "[Track this defect in QAMS|https://qams.example.com/defects/abc]"
    );
  });

  // A guessed origin would render an authoritative-looking link that goes nowhere.
  it("says where the defect lives rather than inventing a link when no base URL is set", () => {
    const { description } = buildDefectIssueFields({ ...defect, defectUrl: null });
    expect(description).not.toContain("[");
    expect(description).toContain("tracked in QAMS");
  });

  // Jira refuses a create over its summary limit outright, so an uncapped summary would mean
  // no bug at all rather than a shortened one.
  it("caps the summary at Jira's limit", () => {
    const { summary } = buildDefectIssueFields({ ...defect, summary: "x".repeat(400) });
    expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS + 1);
    expect(summary.endsWith("…")).toBe(true);
  });

  // A summary is a single line and Jira stores exactly what it is given.
  it("collapses newlines in the summary", () => {
    const { summary } = buildDefectIssueFields({ ...defect, summary: "line one\nline two" });
    expect(summary).toBe("BUG-0001 line one line two");
  });

  // ADR-0004: tester text must never act as formatting in an issue QAMS does not own.
  it("escapes wiki markup a person typed into the description", () => {
    const { description } = buildDefectIssueFields({
      ...defect,
      summary: "{code}rm -rf{code}",
      testCaseTitle: "[click me|http://evil.example]"
    });
    expect(description).toContain("\\{code\\}");
    expect(description).not.toContain("[click me|http://evil.example]");
  });

  it("caps a long free-text field in the description", () => {
    const { description } = buildDefectIssueFields({ ...defect, testCaseTitle: "y".repeat(900) });
    expect(description).toContain("…");
    expect(description).not.toContain("y".repeat(MAX_DEFECT_FIELD_CHARS + 1));
  });
});

describe("buildDefectLifecycleComment", () => {
  const at = new Date("2026-08-12T14:32:11.000Z");

  it("names the defect and the states it moved between", () => {
    const body = buildDefectLifecycleComment({
      defectBusinessId: "BUG-0001",
      from: DefectLifecycleState.IN_PROGRESS,
      to: DefectLifecycleState.RESOLVED,
      actorName: "Renmark Panes",
      occurredAt: at,
      notes: [{ label: "Resolution", value: "Tax applied before the total is rendered." }],
      defectUrl: null,
      timeZone: "UTC"
    });
    expect(body).toContain("*QAMS defect BUG-0001 — In progress → Resolved*");
    expect(body).toContain("By Renmark Panes · 2026-08-12 14:32 UTC");
  });

  // The stamp is drawn in the ORGANIZATION zone and names it. A reader of this comment is a
  // developer on someone else's project who has no zone QAMS could consult, so the name has
  // to be in the text — a bare `22:32` would look unambiguous while being anything but
  // (ADR-0007).
  it("stamps the organization zone, named, when one is configured", () => {
    const body = buildDefectLifecycleComment({
      defectBusinessId: "BUG-0001",
      from: DefectLifecycleState.IN_PROGRESS,
      to: DefectLifecycleState.RESOLVED,
      actorName: "Renmark Panes",
      occurredAt: at,
      notes: [],
      defectUrl: null,
      timeZone: "Asia/Manila"
    });
    expect(body).toContain("By Renmark Panes · 2026-08-12 22:32 Asia/Manila");
    // The same instant. Nothing recorded moved; only how it is drawn did.
    expect(body).not.toContain("14:32");
  });

  // The rationale is the substance: "moved to Resolved" alone tells a developer nothing.
  it("carries the transition rationale", () => {
    const body = buildDefectLifecycleComment({
      defectBusinessId: "BUG-0001",
      from: DefectLifecycleState.RESOLVED,
      to: DefectLifecycleState.CLOSED,
      actorName: "Lead",
      occurredAt: at,
      notes: [
        { label: "Retest evidence", value: "EXE-0042" },
        { label: "Closure rationale", value: "Verified on staging." }
      ],
      defectUrl: null,
      timeZone: "UTC"
    });
    // Escaped, hyphen included. A rationale is free text — it could be an execution ID, a URL
    // or a paragraph — so unlike the business IDs `jira-comment.ts` interpolates raw, nothing
    // here guarantees its shape and all of it goes through the escaper.
    expect(body).toContain("* *Retest evidence:* EXE\\-0042");
    expect(body).toContain("* *Closure rationale:* Verified on staging.");
  });

  it("escapes rationale text a person typed", () => {
    const body = buildDefectLifecycleComment({
      defectBusinessId: "BUG-0001",
      from: DefectLifecycleState.NEW,
      to: DefectLifecycleState.TRIAGED,
      actorName: "Lead",
      occurredAt: at,
      notes: [{ label: "Note", value: "see [here|http://evil.example]" }],
      defectUrl: null,
      timeZone: "UTC"
    });
    expect(body).not.toContain("[here|http://evil.example]");
    expect(body).toContain("\\[here\\|http://evil.example\\]");
  });

  it("omits the note list entirely when a transition carried no rationale", () => {
    const body = buildDefectLifecycleComment({
      defectBusinessId: "BUG-0001",
      from: DefectLifecycleState.NEW,
      to: DefectLifecycleState.TRIAGED,
      actorName: "Lead",
      occurredAt: at,
      notes: [],
      defectUrl: null,
      timeZone: "UTC"
    });
    // The header's own bold markers stay, of course; what must be absent is the bullet list.
    expect(body.split("\n").filter((line) => line.startsWith("* "))).toHaveLength(0);
  });
});

describe("shouldTransitionDefectIssue", () => {
  // Closure is the state that means the fix was actually verified — Resolved is not enough,
  // and a defect can move from Resolved back to In Progress.
  it("transitions the issue only when the defect is Closed", () => {
    expect(shouldTransitionDefectIssue(DefectLifecycleState.CLOSED)).toBe(true);
  });

  it.each([
    [DefectLifecycleState.NEW],
    [DefectLifecycleState.TRIAGED],
    [DefectLifecycleState.IN_PROGRESS],
    [DefectLifecycleState.RESOLVED]
  ])("does not transition the issue at %s", (status) => {
    expect(shouldTransitionDefectIssue(status)).toBe(false);
  });
});
