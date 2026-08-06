// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The server action is the commit boundary and is exercised by the acceptance suite;
// these tests are about what the dialog collects before it is ever called.
vi.mock("./actions", () => ({ finalizeExecutionAction: vi.fn(async () => null) }));

import { FinalizeForm, type FinalizeCase } from "./FinalizeForm";

/**
 * Recording results happens in a per-case dialog, but `docs/business-rules-and-validation.md:28`
 * forbids a partial finalize — so what these tests actually pin is that Save is data entry
 * and the run's single submit is the commit: the hidden inputs must carry every covered
 * case together, and the button must stay shut until they all have a result.
 */

// jsdom does not implement the dialog top layer; the component only needs open/close
// to track the `open` attribute, which is what <dialog> reflects in a browser too.
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
  // The draft outlives a render by design, so it has to be cleared between tests or one
  // test's recorded results become the next one's "picked up where you left off".
  window.sessionStorage.clear();
});

const CASES: FinalizeCase[] = [
  {
    testCaseId: "tc-1",
    businessId: "TC-LOGIN-0001",
    title: "Valid credentials",
    steps: [
      { id: "s-1", action: "Enter a valid username and password", expectedResult: "The dashboard loads" }
    ],
    openDefects: []
  },
  {
    testCaseId: "tc-2",
    businessId: "TC-LOGIN-0002",
    title: "Locked account",
    steps: [{ id: "s-2", action: "Sign in as a locked user", expectedResult: "A lockout notice shows" }],
    openDefects: [{ id: "d-1", businessId: "BUG-0007", summary: "Lockout never lifts" }]
  }
];

/**
 * Each render gets its own execution by default.
 *
 * The draft outlives a single mount on purpose — that is the behaviour under test — and it
 * is keyed by execution, so two tests sharing one id would share one draft and the second
 * would open onto the first's recorded results. Tests that need continuity across mounts
 * pass the id explicitly.
 */
let runSeq = 0;

function renderForm(cases: FinalizeCase[] = CASES, version = 3, executionId?: string) {
  return render(
    <FinalizeForm
      executionId={executionId ?? `exe-${(runSeq += 1)}`}
      version={version}
      cases={cases}
      priorities={["High", "Medium"]}
      severities={["Critical", "Minor"]}
    />
  );
}

const hidden = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

const finalizeButton = () => screen.getByRole("button", { name: /Finalize this run/ });

/** The outcome is a radio group, so a result is chosen by clicking its option. */
const OUTCOME_OPTION: Record<string, string> = { PASS: "Pass", FAIL: "Fail", BLOCKED: "Blocked" };
const outcomeRadio = (result: string) =>
  screen.getByRole("radio", { name: OUTCOME_OPTION[result] }) as HTMLInputElement;

/** Record one case through the dialog, the way a tester does. */
function recordCase(businessId: string, result: string, actual: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(businessId) }));
  fireEvent.click(outcomeRadio(result));
  fireEvent.change(screen.getByLabelText(/What actually happened/), { target: { value: actual } });
}

describe("FinalizeForm", () => {
  it("offers every covered case and finalizes none of them until all are recorded", () => {
    renderForm();

    expect(screen.getByText("0 of 2 cases recorded.")).toBeTruthy();
    expect((finalizeButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Record every case first — a run finalizes whole or not at all.")).toBeTruthy();

    recordCase("TC-LOGIN-0001", "PASS", "Signed in and landed on the dashboard.");
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    expect(screen.getByText("1 of 2 cases recorded.")).toBeTruthy();
    // One case short is still not finalizable — that is the no-partial-finalize rule.
    expect((finalizeButton() as HTMLButtonElement).disabled).toBe(true);

    recordCase("TC-LOGIN-0002", "BLOCKED", "Could not reach the lockout screen.");
    fireEvent.change(screen.getByLabelText(/What blocked it/), {
      target: { value: "Test account was not provisioned." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    expect(screen.getByText("2 of 2 cases recorded.")).toBeTruthy();
    expect((finalizeButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("carries every case's saved values in the one submitted body", () => {
    const { container } = renderForm();

    recordCase("TC-LOGIN-0001", "PASS", "Signed in cleanly.");
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));
    recordCase("TC-LOGIN-0002", "BLOCKED", "Never got there.");
    fireEvent.change(screen.getByLabelText(/What blocked it/), {
      target: { value: "No test account." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    // Both cases post, positionally paired with `caseIds` by the action.
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>('input[name="caseIds"]')).map(
        (input) => input.value
      )
    ).toEqual(["tc-1", "tc-2"]);
    expect(hidden(container, "result:tc-1")).toBe("PASS");
    expect(hidden(container, "actualResult:tc-1")).toBe("Signed in cleanly.");
    expect(hidden(container, "result:tc-2")).toBe("BLOCKED");
    expect(hidden(container, "blockReason:tc-2")).toBe("No test account.");
    // A Pass carries no block reason of its own.
    expect(hidden(container, "blockReason:tc-1")).toBe("");
  });

  it("refuses to save a Fail with neither an existing defect nor a new summary", () => {
    const { container } = renderForm();

    recordCase("TC-LOGIN-0002", "FAIL", "Lockout message never appeared.");
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    expect(screen.getByText("This case still needs a defect")).toBeTruthy();
    expect(screen.getByText(/write a summary for a new one/)).toBeTruthy();
    // Nothing was recorded, so the dialog is still the place to fix it.
    expect(screen.getByText("0 of 2 cases recorded.")).toBeTruthy();
    expect(hidden(container, "result:tc-2")).toBe("");

    fireEvent.change(screen.getByLabelText(/New defect summary/), {
      target: { value: "Lockout never surfaces to the user" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    expect(screen.getByText("1 of 2 cases recorded.")).toBeTruthy();
    expect(hidden(container, "defectSummary:tc-2")).toBe("Lockout never surfaces to the user");
  });

  it("an existing defect satisfies the Fail rule on its own", () => {
    const { container } = renderForm();

    recordCase("TC-LOGIN-0002", "FAIL", "Same failure as BUG-0007.");
    fireEvent.change(screen.getByLabelText(/Existing defect/), { target: { value: "d-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    expect(screen.getByText("1 of 2 cases recorded.")).toBeTruthy();
    expect(hidden(container, "defectId:tc-2")).toBe("d-1");
    expect(hidden(container, "defectSummary:tc-2")).toBe("");
  });

  it("switching a Fail to a Pass drops the defect it was carrying", () => {
    const { container } = renderForm();

    recordCase("TC-LOGIN-0002", "FAIL", "Failed first time round.");
    fireEvent.change(screen.getByLabelText(/New defect summary/), {
      target: { value: "Lockout never lifts" }
    });
    fireEvent.click(outcomeRadio("PASS"));
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    // `business-rules-and-validation.md:30` — a Pass must not create a defect.
    expect(hidden(container, "result:tc-2")).toBe("PASS");
    expect(hidden(container, "defectSummary:tc-2")).toBe("");
    expect(hidden(container, "defectId:tc-2")).toBe("");
  });

  /**
   * A half-finished run has nowhere on the server to live — `business-rules-and-validation.md:28`
   * forbids writing a per-case result before the run is finalized — so the draft is held
   * in the browser. Held only in component state, a reload or a trip to another module
   * discarded everything already recorded.
   */
  describe("a half-finished run survives leaving the page", () => {
    it("restores what was recorded, and says that it did", () => {
      const first = renderForm(CASES, 3, "exe-restore");

      recordCase("TC-LOGIN-0001", "PASS", "Signed in cleanly.");
      fireEvent.click(screen.getByRole("button", { name: "Save result" }));
      expect(screen.getByText("1 of 2 cases recorded.")).toBeTruthy();

      // Leaving the screen and coming back: a fresh mount of the same run.
      first.unmount();
      const { container } = renderForm(CASES, 3, "exe-restore");

      expect(screen.getByText("1 of 2 cases recorded.")).toBeTruthy();
      expect(hidden(container, "result:tc-1")).toBe("PASS");
      expect(hidden(container, "actualResult:tc-1")).toBe("Signed in cleanly.");
      // And it is announced — "1 of 2 recorded" on a just-opened page would otherwise
      // read as work someone else did, or as a run that has already written something.
      expect(screen.getByText("Picked up where you left off")).toBeTruthy();

      // Still not finalizable: restoring a draft must not restore a partial commit.
      expect((finalizeButton() as HTMLButtonElement).disabled).toBe(true);
    });

    it("drops a draft whose run has moved on", () => {
      const first = renderForm(CASES, 3, "exe-moved");
      recordCase("TC-LOGIN-0001", "PASS", "Signed in cleanly.");
      fireEvent.click(screen.getByRole("button", { name: "Save result" }));
      first.unmount();

      // A version bump means the run was started, reassigned or finalized underneath the
      // draft, so the draft no longer describes what is on screen.
      const { container } = renderForm(CASES, 4, "exe-moved");

      expect(screen.getByText("0 of 2 cases recorded.")).toBeTruthy();
      expect(hidden(container, "result:tc-1")).toBe("");
      expect(screen.queryByText("Picked up where you left off")).toBe(null);
    });

    it("ignores a stored entry with no outcome", () => {
      // Hand-edited or left by an older build: a shape-only entry must not count toward
      // "recorded", or Finalize could enable on results nobody chose.
      window.sessionStorage.setItem(
        "qams.finalize.exe-orphan",
        JSON.stringify({ version: 3, recorded: { "tc-1": { actualResult: "orphaned" } } })
      );

      const { container } = renderForm(CASES, 3, "exe-orphan");

      expect(screen.getByText("0 of 2 cases recorded.")).toBeTruthy();
      expect(hidden(container, "actualResult:tc-1")).toBe("");
    });
  });

  it("shows the steps being graded, on the row and in the dialog", () => {
    renderForm();

    // On the row, without committing to opening the dialog: this is how a tester decides
    // which case to pick up next. Both cases' steps are reachable at once.
    expect(screen.getByText("Enter a valid username and password")).toBeTruthy();
    expect(screen.getByText("Sign in as a locked user")).toBeTruthy();
    expect(screen.getByText("Expected: The dashboard loads")).toBeTruthy();

    // And again inside the dialog that records the result, where the grade is decided.
    fireEvent.click(screen.getByRole("button", { name: /TC-LOGIN-0001/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Enter a valid username and password");
    expect(dialog.textContent).toContain("Expected: The dashboard loads");
  });

  it("the case search narrows what is shown but never what is submitted", () => {
    // Six cases: the needle appears past the same >5 rule the record lists use.
    const many: FinalizeCase[] = Array.from({ length: 6 }, (_, i) => ({
      testCaseId: `tc-${i + 1}`,
      businessId: `TC-PROD002-000${i + 1}`,
      title: i === 0 ? "Boundary dates are inclusive" : `Unrelated case ${i + 1}`,
      steps: [{ id: `s-${i + 1}`, action: `Do thing ${i + 1}`, expectedResult: "It works" }],
      openDefects: []
    }));
    const { container } = renderForm(many);

    fireEvent.change(screen.getByLabelText("Search covered cases"), {
      target: { value: "Boundary" }
    });

    expect(screen.getByRole("button", { name: /TC-PROD002-0001/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /TC-PROD002-0002/ })).toBe(null);

    // The whole point: the server must see the entire covered set to reject a partial
    // run, so a narrowed list must not narrow the submitted body.
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>('input[name="caseIds"]')).map(
        (input) => input.value
      )
    ).toEqual(["tc-1", "tc-2", "tc-3", "tc-4", "tc-5", "tc-6"]);
    // And the count still speaks for the run, not for the filtered view.
    expect(screen.getByText("0 of 6 cases recorded.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search covered cases"), {
      target: { value: "nothing matches this" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(screen.getByRole("button", { name: /TC-PROD002-0002/ })).toBeTruthy();
  });

  it("reopens a saved case with its values, and Cancel leaves them untouched", () => {
    const { container } = renderForm();

    recordCase("TC-LOGIN-0001", "PASS", "Signed in cleanly.");
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    fireEvent.click(screen.getByRole("button", { name: /TC-LOGIN-0001/ }));
    expect(outcomeRadio("PASS").checked).toBe(true);
    expect(outcomeRadio("FAIL").checked).toBe(false);
    expect((screen.getByLabelText(/What actually happened/) as HTMLTextAreaElement).value).toBe(
      "Signed in cleanly."
    );

    fireEvent.change(screen.getByLabelText(/What actually happened/), {
      target: { value: "edited but abandoned" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(hidden(container, "actualResult:tc-1")).toBe("Signed in cleanly.");
    expect(screen.getByText("1 of 2 cases recorded.")).toBeTruthy();
  });
});
