import { ExecutionLifecycleState, ExecutionOutcome } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  describeTransitionBlock,
  ensureIssueKeyMutable,
  normalizeJiraIssueKey,
  sanitizeFailureReason,
  shouldTransitionIssue,
  transitionAlreadyCovers,
  type SyncCandidate
} from "./jira-sync";

const finalized = (result: ExecutionOutcome): SyncCandidate => ({
  state: ExecutionLifecycleState.FINALIZED,
  result
});

describe("shouldTransitionIssue", () => {
  it("transitions when the only execution for the key finalized as Pass", () => {
    expect(shouldTransitionIssue([finalized(ExecutionOutcome.PASS)])).toBe(true);
  });

  it("transitions when every execution sharing the key finalized as Pass", () => {
    expect(
      shouldTransitionIssue([
        finalized(ExecutionOutcome.PASS),
        finalized(ExecutionOutcome.PASS),
        finalized(ExecutionOutcome.PASS)
      ])
    ).toBe(true);
  });

  // The case that broke the originally requested rule: finalizing the Chrome run must not
  // mark the ticket Done while Firefox and Safari are still open
  // (`docs/architecture.md#Jira execution sync`).
  it("withholds the transition while any execution for the key is unfinalized", () => {
    expect(
      shouldTransitionIssue([
        finalized(ExecutionOutcome.PASS),
        { state: ExecutionLifecycleState.IN_PROGRESS, result: null },
        { state: ExecutionLifecycleState.PLANNED, result: null }
      ])
    ).toBe(false);
  });

  it("withholds the transition when a finalized execution failed", () => {
    expect(
      shouldTransitionIssue([finalized(ExecutionOutcome.PASS), finalized(ExecutionOutcome.FAIL)])
    ).toBe(false);
  });

  it("withholds the transition when a finalized execution was blocked", () => {
    expect(
      shouldTransitionIssue([finalized(ExecutionOutcome.PASS), finalized(ExecutionOutcome.BLOCKED)])
    ).toBe(false);
  });

  // A single non-Pass run withholds the transition permanently — there is no "latest run
  // wins", because a Finalized execution is immutable and never superseded in place.
  it("stays withheld even when the failing run finalized first", () => {
    expect(
      shouldTransitionIssue([finalized(ExecutionOutcome.FAIL), finalized(ExecutionOutcome.PASS)])
    ).toBe(false);
  });

  // Defensive: a FINALIZED row always carries a derived result in practice, but a null must
  // never read as a pass.
  it("withholds the transition when a finalized execution has no derived result", () => {
    expect(
      shouldTransitionIssue([{ state: ExecutionLifecycleState.FINALIZED, result: null }])
    ).toBe(false);
  });

  it("does not transition when no execution carries the key", () => {
    expect(shouldTransitionIssue([])).toBe(false);
  });
});

describe("normalizeJiraIssueKey", () => {
  it("accepts a well-formed key", () => {
    expect(normalizeJiraIssueKey("PROJ-123")).toBe("PROJ-123");
  });

  it("accepts digits inside the project key", () => {
    expect(normalizeJiraIssueKey("AB1-9")).toBe("AB1-9");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeJiraIssueKey("  PROJ-123  ")).toBe("PROJ-123");
  });

  // Absent is legal: an execution need not be run against a Jira task at all
  // (`docs/data-model.md`).
  it("passes an absent key through as null", () => {
    expect(normalizeJiraIssueKey(null)).toBeNull();
    expect(normalizeJiraIssueKey(undefined)).toBeNull();
    expect(normalizeJiraIssueKey("   ")).toBeNull();
  });

  it.each([
    ["proj-123", "lowercase"],
    ["PROJ123", "no separator"],
    ["PROJ-", "no issue number"],
    ["-123", "no project key"],
    ["A-1", "one-character project key"],
    ["PROJ-12A", "non-numeric issue number"],
    ["PROJ-123 EXTRA", "trailing text"]
  ])("rejects %s (%s)", (raw) => {
    expect(() => normalizeJiraIssueKey(raw)).toThrowError(AppError);
  });

  it("rejects with 422 ID_INVALID naming the field", () => {
    try {
      normalizeJiraIssueKey("nope");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.status).toBe(422);
      expect(appError.code).toBe("ID_INVALID");
      expect(appError.field).toBe("jiraIssueKey");
    }
  });
});

describe("sanitizeFailureReason", () => {
  // The string comes from someone else's HTTP client and is stored forever in an
  // append-only table a QA Lead reads (`docs/api-and-security.md`).
  it("masks a bearer token", () => {
    const cleaned = sanitizeFailureReason("401 from Authorization: Bearer eyJhbGciOiJIUzI1NiJ9");
    expect(cleaned).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(cleaned).toContain("[REDACTED]");
  });

  it("masks basic auth", () => {
    expect(sanitizeFailureReason("Basic dXNlcjpwYXNz rejected")).not.toContain("dXNlcjpwYXNz");
  });

  it.each([
    ["access_token=abc123", "abc123"],
    ["client_secret=shhh", "shhh"],
    ["api_key=k-9", "k-9"],
    ["password=hunter2", "hunter2"]
  ])("masks %s", (input, secret) => {
    expect(sanitizeFailureReason(input)).not.toContain(secret);
  });

  it("strips a query string from a quoted request URL", () => {
    const cleaned = sanitizeFailureReason(
      "GET https://acme.atlassian.net/rest/api/3/issue?jwt=leaky failed"
    );
    expect(cleaned).not.toContain("leaky");
  });

  it("keeps an ordinary message readable", () => {
    expect(sanitizeFailureReason("Transition 31 is not valid from status In Progress")).toBe(
      "Transition 31 is not valid from status In Progress"
    );
  });

  it("bounds the length", () => {
    expect(sanitizeFailureReason("x".repeat(2000)).length).toBe(500);
  });
});

describe("ensureIssueKeyMutable", () => {
  // Mirrors the tester-reassignment rule: changeable while Planned, part of the record
  // afterwards (`docs/roles-workflows.md`).
  it("allows a change while the execution is Planned", () => {
    expect(() => ensureIssueKeyMutable(ExecutionLifecycleState.PLANNED)).not.toThrow();
  });

  it.each([ExecutionLifecycleState.IN_PROGRESS, ExecutionLifecycleState.FINALIZED])(
    "refuses a change once the execution is %s",
    (state) => {
      expect(() => ensureIssueKeyMutable(state)).toThrowError(AppError);
    }
  );

  it("refuses with 422 FORBIDDEN_TRANSITION", () => {
    try {
      ensureIssueKeyMutable(ExecutionLifecycleState.FINALIZED);
      expect.unreachable("should have thrown");
    } catch (error) {
      const appError = error as AppError;
      expect(appError.status).toBe(422);
      expect(appError.code).toBe("FORBIDDEN_TRANSITION");
      expect(appError.field).toBe("jiraIssueKey");
    }
  });
});

describe("transitionAlreadyCovers", () => {
  const at = (iso: string) => new Date(iso);

  it("does not cover an issue that has never been transitioned", () => {
    expect(transitionAlreadyCovers(null, [{ finalizedAt: at("2026-08-11T06:00:00Z") }])).toBe(false);
  });

  it("covers a run that finalized before the last successful transition", () => {
    expect(
      transitionAlreadyCovers(at("2026-08-10T07:49:32Z"), [{ finalizedAt: at("2026-08-10T07:49:29Z") }])
    ).toBe(true);
  });

  it("does NOT cover a run finalized after it -- the reported defect", () => {
    // The exact shape of the incident: an issue transitioned by an earlier run on 10 August,
    // and a separate run finalized all-Pass on 11 August. The old rule suppressed this
    // forever; new evidence must earn a fresh transition (ADR-0005).
    expect(
      transitionAlreadyCovers(at("2026-08-10T07:49:32Z"), [
        { finalizedAt: at("2026-08-10T07:49:29Z") },
        { finalizedAt: at("2026-08-11T06:00:39Z") }
      ])
    ).toBe(false);
  });

  it("covers a run finalized at the same instant, so a replay cannot re-close a ticket", () => {
    const instant = at("2026-08-11T06:00:39Z");
    expect(transitionAlreadyCovers(instant, [{ finalizedAt: instant }])).toBe(true);
  });

  it("treats an unstamped finalize as uncovered rather than assuming it was reported", () => {
    expect(transitionAlreadyCovers(at("2026-08-10T07:49:32Z"), [{ finalizedAt: null }])).toBe(false);
  });
});

describe("describeTransitionBlock", () => {
  const named = (businessId: string, state: ExecutionLifecycleState, result: ExecutionOutcome | null) => ({
    businessId,
    state,
    result
  });

  it("names the runs that have not finalized", () => {
    const reason = describeTransitionBlock([
      named("EXE-0012", ExecutionLifecycleState.FINALIZED, ExecutionOutcome.PASS),
      named("EXE-0013", ExecutionLifecycleState.IN_PROGRESS, null)
    ]);
    expect(reason).toContain("EXE-0013 not finalized yet");
    expect(reason).not.toContain("EXE-0012");
  });

  it("names the runs that finalized without passing, with their result", () => {
    const reason = describeTransitionBlock([
      named("EXE-0012", ExecutionLifecycleState.FINALIZED, ExecutionOutcome.PASS),
      named("EXE-0014", ExecutionLifecycleState.FINALIZED, ExecutionOutcome.FAIL)
    ]);
    expect(reason).toContain("EXE-0014 (FAIL) did not pass");
  });

  it("reports both causes at once rather than only the first", () => {
    const reason = describeTransitionBlock([
      named("EXE-0013", ExecutionLifecycleState.PLANNED, null),
      named("EXE-0014", ExecutionLifecycleState.FINALIZED, ExecutionOutcome.BLOCKED)
    ]);
    expect(reason).toContain("EXE-0013 not finalized yet");
    expect(reason).toContain("EXE-0014 (BLOCKED) did not pass");
  });

  it("answers the unreachable empty set rather than rendering an empty string", () => {
    expect(describeTransitionBlock([])).toBe("No execution carries this issue key.");
  });
});
