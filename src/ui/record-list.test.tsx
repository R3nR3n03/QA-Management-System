// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DefectList, ExecutionList } from "./record-list";
import { makeDefectRows, makeExecutionRows } from "./pagination-fixtures";

/**
 * Component tests for the shipped pagination behavior (DESIGN-SYSTEM.md § Pager) —
 * presentation only, no domain involvement. Every asserted string is the exact
 * shipped wording: the en dash in "Showing 1–50 of 72", the curly quotes in the
 * no-match message, the chip label "In Progress". A mismatch means the TEST is
 * wrong, never the component copy.
 */

afterEach(cleanup);

/** 60 Planned + 12 Finalized — enough for two pages and a meaningful chip filter. */
const executionRows = () => [
  ...makeExecutionRows(60),
  ...makeExecutionRows(12, { state: "FINALIZED", idOffset: 60 })
];

describe("ExecutionList", () => {
  it("renders the lifecycle state chips (Prisma enum values resolve under jsdom)", () => {
    // The canary for the one flagged risk: chips.tsx imports Prisma enum VALUES at
    // runtime. If this renders, the rest of the suite stands on solid ground.
    render(<ExecutionList rows={makeExecutionRows(3)} />);

    expect(screen.getAllByText("Planned").length).toBeGreaterThan(0);
  });

  it("pages 72 rows at 50 with the shared pager", () => {
    render(<ExecutionList rows={executionRows()} />);

    expect(screen.getByRole("navigation", { name: "Pages of the executions" })).toBeTruthy();
    expect(screen.getByText("Showing 1–50 of 72")).toBeTruthy();
    expect(screen.getByText("Execution title 1")).toBeTruthy();
    expect(screen.queryByText("Execution title 51")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Showing 51–72 of 72")).toBeTruthy();
    expect(screen.getByText("Execution title 51")).toBeTruthy();
    expect(screen.queryByText("Execution title 1")).toBeNull();
  });

  it("typing in the filter resets to page 1", () => {
    render(<ExecutionList rows={executionRows()} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 51–72 of 72")).toBeTruthy();

    // "exe" matches every row (EXE-#### ids), so only the page can explain the change.
    fireEvent.change(screen.getByLabelText("Filter executions"), { target: { value: "exe" } });

    expect(screen.getByText("Showing 1–50 of 72")).toBeTruthy();
    expect(screen.getByText("Execution title 1")).toBeTruthy();
  });

  it("lifecycle chips filter by state, carry aria-pressed, and reset the page", () => {
    render(<ExecutionList rows={executionRows()} />);

    const group = screen.getByRole("group", { name: "Filter by lifecycle state" });
    expect(group).toBeTruthy();
    for (const label of ["All", "Planned", "In Progress", "Finalized"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalized" }));

    expect(screen.getByRole("button", { name: "Finalized" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
    // Only the 12 finalized rows remain — under one page, so the pager hides.
    expect(screen.getByText("Execution title 61")).toBeTruthy();
    expect(screen.queryByText("Execution title 1")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();

    // Back to a 60-row state from what WAS page 2: without the reset this would read
    // "Showing 51–60 of 60".
    fireEvent.click(screen.getByRole("button", { name: "Planned" }));
    expect(screen.getByText("Showing 1–50 of 60")).toBeTruthy();
  });

  it("shows the shipped no-match message", () => {
    render(<ExecutionList rows={executionRows()} />);

    fireEvent.change(screen.getByLabelText("Filter executions"), { target: { value: "zzzz" } });

    expect(screen.getByText("No execution matches the current filters.")).toBeTruthy();
  });

  it("hides the filter toolbar at five rows or fewer", () => {
    render(<ExecutionList rows={makeExecutionRows(4)} />);

    expect(screen.queryByLabelText("Filter executions")).toBeNull();
  });

  it("shows the shipped empty state when there are no rows at all", () => {
    render(<ExecutionList rows={[]} />);

    expect(screen.getByText("No executions yet. Plan one against an approved test case.")).toBeTruthy();
  });
});

describe("DefectList", () => {
  it("pages 51 rows at 50 and the filter resets to page 1", () => {
    render(<DefectList rows={makeDefectRows(51)} />);

    expect(screen.getByRole("navigation", { name: "Pages of the defects" })).toBeTruthy();
    expect(screen.getByText("Showing 1–50 of 51")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Defect summary 51")).toBeTruthy();
    expect(screen.getByText("Showing 51–51 of 51")).toBeTruthy();

    // "bug" matches every row (BUG-#### ids) — only the page reset explains page 1.
    fireEvent.change(screen.getByLabelText("Filter defects"), { target: { value: "bug" } });
    expect(screen.getByText("Showing 1–50 of 51")).toBeTruthy();
    expect(screen.getByText("Defect summary 1")).toBeTruthy();
  });

  it("shows the shipped curly-quoted no-match message", () => {
    render(<DefectList rows={makeDefectRows(51)} />);

    fireEvent.change(screen.getByLabelText("Filter defects"), { target: { value: "zzz" } });

    expect(screen.getByText("Nothing matches “zzz”.")).toBeTruthy();
  });

  it("shows the shipped empty state", () => {
    render(<DefectList rows={[]} />);

    expect(screen.getByText("No defects recorded.")).toBeTruthy();
  });
});
