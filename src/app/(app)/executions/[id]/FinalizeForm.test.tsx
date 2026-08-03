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

afterEach(cleanup);

const CASES: FinalizeCase[] = [
  { testCaseId: "tc-1", businessId: "TC-LOGIN-0001", title: "Valid credentials", openDefects: [] },
  {
    testCaseId: "tc-2",
    businessId: "TC-LOGIN-0002",
    title: "Locked account",
    openDefects: [{ id: "d-1", businessId: "BUG-0007", summary: "Lockout never lifts" }]
  }
];

function renderForm(cases: FinalizeCase[] = CASES) {
  return render(
    <FinalizeForm
      executionId="exe-1"
      version={3}
      cases={cases}
      priorities={["High", "Medium"]}
      severities={["Critical", "Minor"]}
    />
  );
}

const hidden = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

const finalizeButton = () => screen.getByRole("button", { name: /Finalize this run/ });

/** Record one case through the dialog, the way a tester does. */
function recordCase(businessId: string, result: string, actual: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(businessId) }));
  fireEvent.change(screen.getByLabelText("Result"), { target: { value: result } });
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
    fireEvent.change(screen.getByLabelText("Result"), { target: { value: "PASS" } });
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    // `business-rules-and-validation.md:30` — a Pass must not create a defect.
    expect(hidden(container, "result:tc-2")).toBe("PASS");
    expect(hidden(container, "defectSummary:tc-2")).toBe("");
    expect(hidden(container, "defectId:tc-2")).toBe("");
  });

  it("reopens a saved case with its values, and Cancel leaves them untouched", () => {
    const { container } = renderForm();

    recordCase("TC-LOGIN-0001", "PASS", "Signed in cleanly.");
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));

    fireEvent.click(screen.getByRole("button", { name: /TC-LOGIN-0001/ }));
    expect((screen.getByLabelText("Result") as HTMLSelectElement).value).toBe("PASS");
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
