// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

  /**
   * The product dropdown and the needle answer different questions, so they are offered
   * on different conditions: the needle once the list is long enough to be worth
   * narrowing, the dropdown as soon as the catalogue has a product in it. A single
   * product does not disqualify it — a catalogue grows one product at a time, and a
   * filter that appears by itself once someone adds a second is one nobody knows to
   * look for.
   */
  it("offers the product filter on a short list, and with a single product", () => {
    render(
      <CaseTable
        rows={makeCaseRows(3)}
        total={3}
        page={1}
        pathname="/test-cases"
        params={{}}
        emptyText="No cases."
        products={[{ id: "prod-1", businessId: "PROD001", name: "Storefront" }]}
      />
    );

    expect(screen.getByLabelText("Filter by product")).toBeTruthy();
    expect(screen.getByRole("option", { name: "PROD001 · Storefront" })).toBeTruthy();
    // Three rows is still too short to earn a needle: the two gates are independent.
    expect(screen.queryByLabelText("Filter test cases")).toBeNull();
  });

  it("leaves the product filter off entirely when no products are passed", () => {
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

    // `/review` and `/my-work/drafts` share this component and pass no products.
    expect(screen.queryByLabelText("Filter by product")).toBeNull();
    expect(screen.getByLabelText("Filter test cases")).toBeTruthy();
  });

  it("commits a chosen product to the URL and returns to the first page", () => {
    nav.search = "q=login&page=4";
    render(
      <CaseTable
        rows={makeCaseRows(50)}
        total={132}
        page={4}
        pathname="/test-cases"
        params={{ q: "login", page: "4" }}
        emptyText="No cases."
        products={[
          { id: "prod-1", businessId: "PROD001", name: "Storefront" },
          { id: "prod-2", businessId: "PROD002", name: "Back office" }
        ]}
      />
    );

    fireEvent.change(screen.getByLabelText("Filter by product"), {
      target: { value: "prod-2" }
    });

    // The needle survives (the two filters compose) and `page` is dropped, because a
    // narrower list has fewer pages and page 4 of it may not exist.
    expect(nav.replace).toHaveBeenCalledWith("/test-cases?q=login&product=prod-2", {
      scroll: false
    });
  });

  it("keeps the controls on screen when the product filter is what emptied the list", () => {
    nav.search = "product=prod-2";
    render(
      <CaseTable
        rows={[]}
        total={0}
        page={1}
        pathname="/test-cases"
        params={{ product: "prod-2" }}
        emptyText="No test cases yet."
        products={[
          { id: "prod-1", businessId: "PROD001", name: "Storefront" },
          { id: "prod-2", businessId: "PROD002", name: "Back office" }
        ]}
      />
    );

    // Not "no test cases yet" — there are plenty, just none in this product. And the
    // filter that emptied it stays put, or there is no way left to clear it.
    expect(screen.getByText("No test case belongs to this product.")).toBeTruthy();
    expect((screen.getByLabelText("Filter by product") as HTMLSelectElement).value).toBe("prod-2");
  });

  /**
   * `/review` and `/my-work/drafts` are already scoped — to In Review, and to the
   * viewer's own unfinished work. The default sentence claims the product holds no test
   * cases at all, which on those screens is usually false and reads as a data problem.
   */
  it("lets an already-scoped screen say which nothing it means", () => {
    nav.search = "product=prod-1";
    render(
      <CaseTable
        rows={[]}
        total={0}
        page={1}
        pathname="/review"
        params={{ product: "prod-1" }}
        emptyText="Nothing is waiting for review."
        products={[{ id: "prod-1", businessId: "PROD001", name: "Storefront" }]}
        productEmptyText="Nothing in this product is waiting for review."
      />
    );

    expect(screen.getByText("Nothing in this product is waiting for review.")).toBeTruthy();
    expect(screen.queryByText("No test case belongs to this product.")).toBeNull();
  });

  it("names both filters when a needle inside a product matches nothing", () => {
    nav.search = "q=zzz&product=prod-1";
    render(
      <CaseTable
        rows={[]}
        total={0}
        page={1}
        pathname="/test-cases"
        params={{ q: "zzz", product: "prod-1" }}
        emptyText="No test cases yet."
        products={[{ id: "prod-1", businessId: "PROD001", name: "Storefront" }]}
      />
    );

    expect(screen.getByText("Nothing matches “zzz” in this product.")).toBeTruthy();
  });

  it("offers the feature filter independently of the product filter", () => {
    render(
      <CaseTable
        rows={makeCaseRows(3)}
        total={3}
        page={1}
        pathname="/test-cases"
        params={{}}
        emptyText="No cases."
        features={[{ id: "feat-1", businessId: "FEAT001", name: "Card payment" }]}
      />
    );

    expect(screen.getByLabelText("Filter by feature")).toBeTruthy();
    expect(screen.getByRole("option", { name: "FEAT001 · Card payment" })).toBeTruthy();
  });

  it("leaves the feature filter off entirely when no features are passed", () => {
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

    expect(screen.queryByLabelText("Filter by feature")).toBeNull();
  });

  it("commits a chosen feature to the URL alongside an existing product filter", () => {
    nav.search = "product=prod-1&page=4";
    render(
      <CaseTable
        rows={makeCaseRows(50)}
        total={132}
        page={4}
        pathname="/test-cases"
        params={{ product: "prod-1", page: "4" }}
        emptyText="No cases."
        products={[{ id: "prod-1", businessId: "PROD001", name: "Storefront" }]}
        features={[{ id: "feat-1", businessId: "FEAT001", name: "Card payment" }]}
      />
    );

    fireEvent.change(screen.getByLabelText("Filter by feature"), {
      target: { value: "feat-1" }
    });

    expect(nav.replace).toHaveBeenCalledWith("/test-cases?product=prod-1&feature=feat-1", {
      scroll: false
    });
  });

  it("keeps the controls on screen when the feature filter is what emptied the list", () => {
    nav.search = "feature=feat-1";
    render(
      <CaseTable
        rows={[]}
        total={0}
        page={1}
        pathname="/test-cases"
        params={{ feature: "feat-1" }}
        emptyText="No test cases yet."
        features={[{ id: "feat-1", businessId: "FEAT001", name: "Card payment" }]}
      />
    );

    expect(screen.getByText("No test case belongs to this feature.")).toBeTruthy();
    expect((screen.getByLabelText("Filter by feature") as HTMLSelectElement).value).toBe("feat-1");
  });

  it("names both filters when a product and a feature combine to empty the list, with no needle", () => {
    nav.search = "product=prod-1&feature=feat-1";
    render(
      <CaseTable
        rows={[]}
        total={0}
        page={1}
        pathname="/test-cases"
        params={{ product: "prod-1", feature: "feat-1" }}
        emptyText="No test cases yet."
        products={[{ id: "prod-1", businessId: "PROD001", name: "Storefront" }]}
        features={[{ id: "feat-1", businessId: "FEAT001", name: "Card payment" }]}
      />
    );

    expect(screen.getByText("No test case belongs to this product and this feature.")).toBeTruthy();
  });

  it("names both filters in the needle's empty message", () => {
    nav.search = "q=zzz&product=prod-1&feature=feat-1";
    render(
      <CaseTable
        rows={[]}
        total={0}
        page={1}
        pathname="/test-cases"
        params={{ q: "zzz", product: "prod-1", feature: "feat-1" }}
        emptyText="No test cases yet."
        products={[{ id: "prod-1", businessId: "PROD001", name: "Storefront" }]}
        features={[{ id: "feat-1", businessId: "FEAT001", name: "Card payment" }]}
      />
    );

    expect(screen.getByText("Nothing matches “zzz” in this product and this feature.")).toBeTruthy();
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
