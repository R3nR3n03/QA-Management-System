// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    scroll: _scroll,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    scroll?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/executions",
  useSearchParams: () => new URLSearchParams(nav.search)
}));

import { DefectList, ExecutionList } from "./record-list";
import { makeDefectRows, makeExecutionRows } from "./pagination-fixtures";

/**
 * The executions and defects lists after the move to server paging — presentation only,
 * no domain involvement. Both render exactly the page they are handed, so the assertions
 * are about the links they build: the state chips are `<a href>`s now, and every one of
 * them must drop the page key, or filtering from page 4 lands on an empty page.
 *
 * Every asserted string is the exact shipped wording: the en dash in "Showing 1–50 of
 * 72", the curly quotes in the no-match message, the chip label "In Progress". A
 * mismatch means the TEST is wrong, never the component copy.
 */

afterEach(cleanup);
beforeEach(() => {
  nav.search = "";
  nav.replace.mockClear();
});

const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

describe("ExecutionList", () => {
  it("renders the lifecycle state chips (Prisma enum values resolve under jsdom)", () => {
    render(
      <ExecutionList
        rows={makeExecutionRows(2, { state: "IN_PROGRESS" })}
        total={2}
        page={1}
        pathname="/executions"
        params={{}}
      />
    );
    expect(screen.getAllByText("In Progress").length).toBeGreaterThan(0);
  });

  it("pages from the server's total with the rows it was handed", () => {
    render(
      <ExecutionList
        rows={makeExecutionRows(50)}
        total={72}
        page={1}
        pathname="/executions"
        params={{}}
      />
    );

    expect(screen.getByText("EXE-0001")).toBeTruthy();
    expect(screen.getByText("EXE-0050")).toBeTruthy();
    expect(screen.getByText("Showing 1–50 of 72")).toBeTruthy();
    expect(href("Next")).toBe("/executions?page=2");
  });

  it("state chips are links that reset the page", () => {
    render(
      <ExecutionList
        rows={makeExecutionRows(50)}
        total={72}
        page={4}
        pathname="/executions"
        params={{ page: "4" }}
      />
    );

    // Page 4 of the unfiltered list; picking a state must go back to page 1.
    expect(href("Finalized")).toBe("/executions?state=FINALIZED");
    // "All" is the absence of the filter, not a value of it.
    expect(href("All")).toBe("/executions");
  });

  it("marks the active state chip and keeps the search needle when switching", () => {
    nav.search = "q=login&state=PLANNED";
    render(
      <ExecutionList
        rows={makeExecutionRows(3)}
        total={3}
        page={1}
        pathname="/executions"
        params={{ q: "login", state: "PLANNED" }}
      />
    );

    expect(screen.getByRole("link", { name: "Planned" }).getAttribute("aria-current")).toBe("true");
    expect(href("Finalized")).toBe("/executions?q=login&state=FINALIZED");
  });

  it("separates an empty list from an empty filter result", () => {
    const { unmount } = render(
      <ExecutionList rows={[]} total={0} page={1} pathname="/executions" params={{}} />
    );
    expect(
      screen.getByText("No executions yet. Plan one against an approved test case.")
    ).toBeTruthy();
    unmount();

    nav.search = "state=FINALIZED";
    render(
      <ExecutionList
        rows={[]}
        total={0}
        page={1}
        pathname="/executions"
        params={{ state: "FINALIZED" }}
      />
    );
    expect(screen.getByText("No execution matches the current filters.")).toBeTruthy();
  });
});

describe("DefectList", () => {
  it("pages from the server's total", () => {
    render(
      <DefectList rows={makeDefectRows(50)} total={60} page={1} pathname="/defects" params={{}} />
    );

    expect(screen.getByText("BUG-0001")).toBeTruthy();
    expect(screen.getByText("Showing 1–50 of 60")).toBeTruthy();
    expect(href("Next")).toBe("/defects?page=2");
  });

  it("shows the shipped no-match wording when a filter matches nothing", () => {
    nav.search = "q=zzz";
    render(<DefectList rows={[]} total={0} page={1} pathname="/defects" params={{ q: "zzz" }} />);
    expect(screen.getByText("Nothing matches “zzz”.")).toBeTruthy();
  });

  it("falls back to the empty state when there are no defects at all", () => {
    render(<DefectList rows={[]} total={0} page={1} pathname="/defects" params={{}} />);
    expect(screen.getByText("No defects recorded.")).toBeTruthy();
  });
});
