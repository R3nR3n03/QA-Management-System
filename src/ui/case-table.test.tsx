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
  usePathname: () => "/test-cases",
  useSearchParams: () => new URLSearchParams(nav.search)
}));

import { CaseTable } from "./case-table";
import { makeCaseRows } from "./pagination-fixtures";

/**
 * The shared test-case list (`/test-cases`, `/review`, `/my-work/drafts`) after the move
 * to server paging. The contract inverted: this component no longer decides which rows
 * to show, it renders exactly the page it was handed. So what is worth asserting is that
 * it renders ALL of them (no leftover slicing), that `total` — not `rows.length` — drives
 * the pager, and the filter-visibility rule that keeps a filter clearable.
 *
 * Every asserted string is the exact shipped wording, curly quotes and en dash included.
 * A mismatch means the TEST is wrong, never the component copy.
 */

afterEach(cleanup);
beforeEach(() => {
  nav.search = "";
  nav.replace.mockClear();
});

describe("CaseTable", () => {
  it("renders exactly the page it was given and never re-slices it", () => {
    // 50 rows handed over WITH a total of 132: the server already paged.
    render(
      <CaseTable
        rows={makeCaseRows(50)}
        total={132}
        page={1}
        pathname="/test-cases"
        params={{}}
        emptyText="No cases."
      />
    );

    expect(screen.getByText("TC-FIX-0001")).toBeTruthy();
    expect(screen.getByText("TC-FIX-0050")).toBeTruthy();
    expect(screen.getByText("Showing 1–50 of 132")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/test-cases?page=2"
    );
  });

  it("pages from the server's total, not from how many rows arrived", () => {
    // Page 3 of 132 is a short page — the pager must still say 132, and stop here.
    render(
      <CaseTable
        rows={makeCaseRows(32)}
        total={132}
        page={3}
        pathname="/test-cases"
        params={{ page: "3" }}
        emptyText="No cases."
      />
    );

    expect(screen.getByText("Showing 101–132 of 132")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });

  it("carries an active filter into the page links", () => {
    nav.search = "q=login";
    render(
      <CaseTable
        rows={makeCaseRows(50)}
        total={132}
        page={1}
        pathname="/test-cases"
        params={{ q: "login" }}
        emptyText="No cases."
      />
    );

    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/test-cases?q=login&page=2"
    );
  });

  it("hides the filter for a short list but keeps it once one is applied", () => {
    const { unmount } = render(
      <CaseTable
        rows={makeCaseRows(3)}
        total={3}
        page={1}
        pathname="/test-cases"
        params={{}}
        emptyText="No cases."
      />
    );
    expect(screen.queryByLabelText("Filter test cases")).toBeNull();
    unmount();

    // One match left: hiding the box now would strand the viewer with no way to clear it.
    nav.search = "q=TC-FIX-0001";
    render(
      <CaseTable
        rows={makeCaseRows(1)}
        total={1}
        page={1}
        pathname="/test-cases"
        params={{ q: "TC-FIX-0001" }}
        emptyText="No cases."
      />
    );
    expect(screen.getByLabelText("Filter test cases")).toBeTruthy();
  });

  it("distinguishes an empty list from an empty filter result", () => {
    const { unmount } = render(
      <CaseTable
        rows={[]}
        total={0}
        page={1}
        pathname="/test-cases"
        params={{}}
        emptyText="No test cases yet."
      />
    );
    expect(screen.getByText("No test cases yet.")).toBeTruthy();
    unmount();

    nav.search = "q=zzz";
    render(
      <CaseTable
        rows={[]}
        total={0}
        page={1}
        pathname="/test-cases"
        params={{ q: "zzz" }}
        emptyText="No test cases yet."
      />
    );
    expect(screen.getByText("Nothing matches “zzz”.")).toBeTruthy();
    expect(screen.queryByText("No test cases yet.")).toBeNull();
  });

  it("seeds the filter box from the URL, so a shared link shows its own needle", () => {
    nav.search = "q=login";
    render(
      <CaseTable
        rows={makeCaseRows(6)}
        total={6}
        page={1}
        pathname="/test-cases"
        params={{ q: "login" }}
        emptyText="No cases."
      />
    );

    expect((screen.getByLabelText("Filter test cases") as HTMLInputElement).value).toBe("login");
  });
});
