// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RowsTable } from "./RowsTable";
import { makeImportRows } from "@/ui/pagination-fixtures";

/**
 * The import row report: column sort (real buttons with `aria-sort` and sr-only
 * captions) composed with the shared pager that superseded the binary "Show all"
 * reveal — and the rule that EVERY sort click resets to page 1, because a new order
 * renumbers every page.
 *
 * Fixture shape (60 rows): rows 1–30 on sheet "Alpha", 31–60 on "Beta"; default
 * sort (sheet, then row) puts "Beta · 51"…"Beta · 60" on page 2.
 */

afterEach(cleanup);

const sheetHeader = () => screen.getByRole("columnheader", { name: /Sheet · row/ });
const outcomeHeader = () => screen.getByRole("columnheader", { name: /Outcome/ });

describe("RowsTable", () => {
  it("sorts by sheet · row ascending by default and pages at 50", () => {
    render(<RowsTable rows={makeImportRows(60)} runId="RUN-1" />);

    expect(sheetHeader().getAttribute("aria-sort")).toBe("ascending");
    expect(sheetHeader().textContent).toContain("(sorted ascending)");
    expect(outcomeHeader().getAttribute("aria-sort")).toBeNull();
    expect(outcomeHeader().textContent).toContain("(sort)");

    expect(screen.getByRole("navigation", { name: "Pages of the import row report" })).toBeTruthy();
    expect(screen.getByText("Showing 1–50 of 60")).toBeTruthy();
    expect(screen.getByText("Alpha · 1")).toBeTruthy();
    expect(screen.queryByText("Beta · 51")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Beta · 51")).toBeTruthy();
    expect(screen.getByText("Showing 51–60 of 60")).toBeTruthy();
  });

  it("clicking the active header flips the direction", () => {
    render(<RowsTable rows={makeImportRows(60)} runId="RUN-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Sheet · row/ }));

    expect(sheetHeader().getAttribute("aria-sort")).toBe("descending");
    expect(sheetHeader().textContent).toContain("(sorted descending)");
    // Descending puts the highest Beta row first and pushes Alpha's start off-page.
    expect(screen.getByText("Beta · 60")).toBeTruthy();
    expect(screen.queryByText("Alpha · 1")).toBeNull();
  });

  it("clicking another header sorts it ascending and releases the old aria-sort", () => {
    render(<RowsTable rows={makeImportRows(60)} runId="RUN-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Outcome/ }));

    expect(outcomeHeader().getAttribute("aria-sort")).toBe("ascending");
    expect(sheetHeader().getAttribute("aria-sort")).toBeNull();
    expect(sheetHeader().textContent).toContain("(sort)");
  });

  it("every sort click resets to page 1", () => {
    render(<RowsTable rows={makeImportRows(60)} runId="RUN-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 51–60 of 60")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Outcome/ }));
    expect(screen.getByText("Showing 1–50 of 60")).toBeTruthy();

    // Also on a direction flip of the same header.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Outcome/ }));
    expect(screen.getByText("Showing 1–50 of 60")).toBeTruthy();
    expect(outcomeHeader().getAttribute("aria-sort")).toBe("descending");
  });

  it("hides the pager when the report fits one page", () => {
    render(<RowsTable rows={makeImportRows(10)} runId="RUN-1" />);

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("Alpha · 1")).toBeTruthy();
  });
});
