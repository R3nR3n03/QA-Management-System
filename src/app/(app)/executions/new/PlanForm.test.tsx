// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The server action is the commit boundary and is exercised by the acceptance suite;
// these tests are about which case ids the form puts in the body before it is called.
vi.mock("./actions", () => ({ createExecutionAction: vi.fn(async () => null) }));

import { PlanForm } from "./PlanForm";

/**
 * The planner picks the cases a run will cover. Two things narrow what is on screen —
 * the filter, and the cap on how many rows are rendered at once — and NEITHER may
 * narrow what is submitted. A silently dropped case means a run that covers less than
 * the person planning it believed, which they would only discover at finalize.
 *
 * So every assertion here is about the submitted body rather than the visible list.
 */

afterEach(cleanup);

const pad = (n: number) => String(n).padStart(4, "0");

function makeCases(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return { id: `case-${n}`, businessId: `TC-PLAN-${pad(n)}`, title: `Candidate ${n}` };
  });
}

const TESTERS = [{ id: "user-1", displayName: "Ada Tester" }];

/** Every case id the form would post: ticked checkboxes plus the hidden carriers. */
function submittedIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[name="testCaseIds"]')
  )
    .filter((input) => input.type === "hidden" || input.checked)
    .map((input) => input.value)
    .sort();
}

const filterBox = () => screen.getByLabelText("Filter approved test cases");

describe("PlanForm", () => {
  it("starts with the preselected cases ticked", () => {
    const { container } = render(
      <PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-2", "case-5"]} />
    );

    expect(screen.getByText(/2 cases selected/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-2", "case-5"]);
  });

  it("keeps a selection that the filter has hidden", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PLAN-0002/ }));
    // Narrow to a case that is not the selected one — the tick leaves the screen.
    fireEvent.change(filterBox(), { target: { value: "Candidate 4" } });

    expect(screen.queryByRole("checkbox", { name: /TC-PLAN-0002/ })).toBeNull();
    expect(screen.getByText(/1 case selected \(1 not shown\)/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-2"]);
  });

  it("renders a bounded number of rows and says what it withheld", () => {
    render(<PlanForm cases={makeCases(140)} testers={TESTERS} />);

    expect(screen.getAllByRole("checkbox")).toHaveLength(100);
    expect(
      screen.getByText(
        "Showing the first 100 of 140 approved cases — narrow the filter to reach the rest. Anything already selected still submits."
      )
    ).toBeTruthy();
    // The cap is on rendering, not on reach: the filter still finds a withheld case.
    fireEvent.change(filterBox(), { target: { value: "TC-PLAN-0137" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("submits a preselected case that falls past the render cap", () => {
    const { container } = render(
      <PlanForm cases={makeCases(140)} testers={TESTERS} preselect={["case-137"]} />
    );

    expect(screen.queryByRole("checkbox", { name: /TC-PLAN-0137/ })).toBeNull();
    expect(submittedIds(container)).toEqual(["case-137"]);
  });

  it("selects and clears only what is on screen, leaving the rest alone", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PLAN-0001/ }));
    fireEvent.change(filterBox(), { target: { value: "Candidate 4" } });
    fireEvent.click(screen.getByRole("button", { name: "Select all 1 shown" }));

    expect(submittedIds(container)).toEqual(["case-1", "case-4"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear the 1 shown" }));
    // Case 1 was never on screen for that clear, so it survives it.
    expect(submittedIds(container)).toEqual(["case-1"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(submittedIds(container)).toEqual([]);
  });

  it("reports cases a rerun could not carry over", () => {
    render(<PlanForm cases={makeCases(3)} testers={TESTERS} preselect={["case-1"]} unavailable={2} />);

    expect(screen.getByText("2 cases could not be carried over")).toBeTruthy();
    expect(screen.getByText(/no longer Approved/)).toBeTruthy();
  });
});
