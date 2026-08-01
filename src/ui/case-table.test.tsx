// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CaseTable } from "./case-table";
import { makeCaseRows } from "./pagination-fixtures";

/**
 * The shared test-case list (`/test-cases`, `/review`, `/my-work/drafts`): pager past
 * 50 rows, filter-driven page reset, the FilterToolbar contract as this consumer
 * exercises it (>5-row visibility, Escape clears), and both empty states with their
 * exact shipped wording.
 */

afterEach(cleanup);

describe("CaseTable", () => {
  it("pages 60 rows at 50; page 2 shows rows 51 and up", () => {
    render(<CaseTable rows={makeCaseRows(60)} emptyText="No cases." />);

    expect(screen.getByRole("navigation", { name: "Pages of the test cases" })).toBeTruthy();
    expect(screen.getByText("Showing 1–50 of 60")).toBeTruthy();
    expect(screen.getByText("TC-FIX-0001")).toBeTruthy();
    expect(screen.queryByText("TC-FIX-0051")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Showing 51–60 of 60")).toBeTruthy();
    expect(screen.getByText("TC-FIX-0051")).toBeTruthy();
    expect(screen.getByText("Case title 60")).toBeTruthy();
    expect(screen.queryByText("TC-FIX-0001")).toBeNull();
  });

  it("changing the filter resets to page 1", () => {
    render(<CaseTable rows={makeCaseRows(60)} emptyText="No cases." />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 51–60 of 60")).toBeTruthy();

    // "case" matches every row title, so only the page reset explains the change.
    fireEvent.change(screen.getByLabelText("Filter test cases"), { target: { value: "case" } });

    expect(screen.getByText("Showing 1–50 of 60")).toBeTruthy();
    expect(screen.getByText("TC-FIX-0001")).toBeTruthy();
  });

  it("Escape clears the filter (FilterToolbar behavior through this consumer)", () => {
    render(<CaseTable rows={makeCaseRows(60)} emptyText="No cases." />);
    const input = screen.getByLabelText("Filter test cases") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches “zzz”.")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(screen.getByText("TC-FIX-0001")).toBeTruthy();
  });

  it("shows the filter toolbar only past five rows", () => {
    const { rerender } = render(<CaseTable rows={makeCaseRows(5)} emptyText="No cases." />);
    expect(screen.queryByLabelText("Filter test cases")).toBeNull();

    rerender(<CaseTable rows={makeCaseRows(6)} emptyText="No cases." />);
    expect(screen.getByLabelText("Filter test cases")).toBeTruthy();
  });

  it("renders the caller's empty text in a .card.empty when there are no rows", () => {
    const { container } = render(<CaseTable rows={[]} emptyText="No cases yet — author one." />);

    expect(container.querySelector(".card.empty")).toBeTruthy();
    expect(screen.getByText("No cases yet — author one.")).toBeTruthy();
  });
});
