// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("./actions", () => ({ finalizeExecutionAction: vi.fn(async () => null) }));

import { FinalizeForm, type FinalizeCase } from "./FinalizeForm";
import { RunSummary } from "./RunSummary";

/**
 * A per-case result cannot be written before the whole run is finalized
 * (`docs/business-rules-and-validation.md:28`), so on an In Progress run the summary card
 * has nothing on the server to count. Reading only the server, it sat at "Pass 0 / Not
 * graded 6" while the tester's own recorded Pass showed on the row below it.
 */

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const CASES: FinalizeCase[] = [
  {
    testCaseId: "tc-1",
    businessId: "TC-LOGIN-0001",
    title: "Valid credentials",
    steps: [{ id: "s-1", action: "Sign in", expectedResult: "The dashboard loads" }],
    openDefects: []
  },
  {
    testCaseId: "tc-2",
    businessId: "TC-LOGIN-0002",
    title: "Locked account",
    steps: [{ id: "s-2", action: "Sign in as a locked user", expectedResult: "A lockout notice" }],
    openDefects: []
  }
];

const SUMMARY_CASES = CASES.map((covered) => ({ testCaseId: covered.testCaseId, result: null }));

/**
 * The number under one heading of the tally, read the way the markup pairs them — and
 * scoped to the card, because the same outcome words appear on the case rows beside it.
 * That the two can be told apart at all is the point of the card being a `<dl>`.
 */
function tally(label: string): string {
  const card = document.querySelector(".run-summary") as HTMLElement;
  const term = within(card).getByText(label);
  return within(term.parentElement as HTMLElement).getByRole("definition").textContent ?? "";
}

describe("RunSummary", () => {
  it("counts the results held for a run being worked, as they are recorded", () => {
    const run = { executionId: "exe-live", version: 3 };
    render(
      <>
        <RunSummary cases={SUMMARY_CASES} draft={run} />
        <FinalizeForm
          executionId={run.executionId}
          version={run.version}
          cases={CASES}
          priorities={[]}
          severities={[]}
        />
      </>
    );

    expect(tally("Pass")).toBe("0");
    expect(tally("Not graded")).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: /TC-LOGIN-0001/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Pass" }));
    fireEvent.change(screen.getByLabelText(/What actually happened/), {
      target: { value: "Signed in cleanly." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    // The card and the working list read one store, so they cannot disagree.
    expect(tally("Pass")).toBe("1");
    expect(tally("Not graded")).toBe("1");
    expect(screen.getByText("1 of 2 cases recorded.")).toBeTruthy();
    // And it says the numbers are held rather than written — nothing has been submitted.
    expect(screen.getByText(/Counting 1 result held in this tab/)).toBeTruthy();
  });

  it("says nothing about a draft on a run with nothing recorded", () => {
    render(<RunSummary cases={SUMMARY_CASES} draft={{ executionId: "exe-empty", version: 1 }} />);

    expect(tally("Total")).toBe("2");
    expect(tally("Not graded")).toBe("2");
    expect(screen.queryByText(/held in this tab/)).toBe(null);
  });

  it("counts the persisted results where there is no draft to read", () => {
    // A finalized run: the results ARE the record, and the card must not hedge about them.
    window.sessionStorage.setItem(
      "qams.finalize.exe-done",
      JSON.stringify({ version: 4, recorded: { "tc-1": { result: "BLOCKED", actualResult: "stale" } } })
    );

    render(
      <RunSummary
        cases={[
          { testCaseId: "tc-1", result: "PASS" },
          { testCaseId: "tc-2", result: "FAIL" }
        ]}
        draft={null}
      />
    );

    expect(tally("Pass")).toBe("1");
    expect(tally("Fail")).toBe("1");
    expect(tally("Blocked")).toBe("0");
    expect(tally("Not graded")).toBe("0");
    expect(screen.queryByText(/held in this tab/)).toBe(null);
  });

  it("ignores a draft left behind by a run that has since moved on", () => {
    window.sessionStorage.setItem(
      "qams.finalize.exe-moved",
      JSON.stringify({ version: 2, recorded: { "tc-1": { result: "PASS", actualResult: "old" } } })
    );

    render(<RunSummary cases={SUMMARY_CASES} draft={{ executionId: "exe-moved", version: 3 }} />);

    expect(tally("Pass")).toBe("0");
    expect(tally("Not graded")).toBe("2");
  });
});
