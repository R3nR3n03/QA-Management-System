// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * `pathname` is settable because the URL-backed filters build their destination from
 * `usePathname()`, NOT from the `pathname` prop the server passes for its links. A test
 * that renders the defects list under a hard-coded "/executions" would assert the wrong
 * URL and pass anyway.
 */
const nav = vi.hoisted(() => ({ search: "", pathname: "/executions", replace: vi.fn() }));

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
  usePathname: () => nav.pathname,
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
  nav.pathname = "/executions";
  nav.replace.mockClear();
});

const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

/**
 * A row's `·`-separated metadata line, composed text and all.
 *
 * `getByText` joins only an element's DIRECT text nodes, so a fact rendered inside its own
 * `<span>` or `<time>` is invisible to a regex over the line. Reading `textContent` off the
 * line asserts what a reader actually sees, in order.
 */
const metaLine = () => screen.getByText(/Fixture Tester/).textContent;

describe("ExecutionList", () => {
  it("renders the lifecycle state chips (Prisma enum values resolve under jsdom)", () => {
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
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
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
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
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
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
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
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

  it("names the last thing that happened, and which cases the run's result came from", () => {
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={[
          {
            id: "execution-9",
            businessId: "EXE-0009",
            state: "FINALIZED",
            result: "FAIL",
            caseBusinessIds: ["TC-FIX-0001", "TC-FIX-0002", "TC-FIX-0003"],
            purpose: "Checkout regression, Chrome",
            testerName: "Fixture Tester",
            jiraIssueKey: null,
            caseResults: ["PASS", "FAIL", "PASS"],
            plannedAt: new Date("2026-01-05T09:00:00.000Z"),
            startedAt: new Date("2026-01-06T10:30:00.000Z"),
            finalizedAt: new Date("2026-01-07T14:45:00.000Z")
          }
        ]}
        total={1}
        page={1}
        pathname="/executions"
        params={{}}
      />
    );

    // The run's chip is only the derived worst outcome, so a 2-pass/1-fail run and a
    // 3-fail run wear the same red Fail. The row has to say which of the two it is.
    expect(screen.getByText(/\+2 more \(2 passed, 1 failed\)/)).toBeTruthy();
    // The newest of the three stamps, and the verb that says which one it is.
    expect(screen.getByText(/· Finalized$/)).toBeTruthy();
    // No zone label on the stamp itself — it is constant for a viewer and is stated once in
    // the shell instead of on every row (ADR-0007).
    expect(screen.getByText("2026-01-07 14:45")).toBeTruthy();
  });

  /**
   * The viewer's zone moves the TEXT and nothing else.
   *
   * The `dateTime` attribute keeps carrying the instant, which is the whole reason `<time>`
   * is used here: a screen reader, a copy-paste or a script gets the unambiguous UTC value
   * whatever clock the reader happens to be on (ADR-0007). Losing that would be the one way
   * localising a stamp could destroy information rather than just present it.
   */
  it("renders the stamp on the viewer's clock while the machine-readable instant stays UTC", () => {
    const { container } = render(
      <ExecutionList
        stampFormat={{ timeZone: "Asia/Manila", clock: "h23" }}
        rows={makeExecutionRows(1, { state: "PLANNED" })}
        total={1}
        page={1}
        pathname="/executions"
        params={{}}
      />
    );

    // 09:00 UTC is 17:00 in Manila. Same instant, different clock.
    expect(screen.getByText("2026-01-05 17:00")).toBeTruthy();
    expect(container.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-01-05T09:00:00.000Z"
    );
  });

  /**
   * The 12-hour choice reaches a rendered row, and the instant still does not move.
   *
   * Both halves of `StampFormat` travel together to every stamp, so this asserts the pair
   * rather than the clock alone: 17:00 in Manila is `05:00 PM`, and the `dateTime` attribute
   * is the same UTC instant it was on the 24-hour clock (ADR-0007).
   */
  it("renders the stamp on a 12-hour clock when the viewer chose one", () => {
    const { container } = render(
      <ExecutionList
        stampFormat={{ timeZone: "Asia/Manila", clock: "h12" }}
        rows={makeExecutionRows(1, { state: "PLANNED" })}
        total={1}
        page={1}
        pathname="/executions"
        params={{}}
      />
    );

    expect(screen.getByText("2026-01-05 05:00 PM")).toBeTruthy();
    expect(container.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-01-05T09:00:00.000Z"
    );
  });

  it("heads the row with the run's purpose, and that is the link into the run", () => {
    // The headline used to be the FIRST covered case's title, which named 1 of N cases as
    // if it were the whole run. The covered IDs stay on the row; the title does not.
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeExecutionRows(1)}
        total={1}
        page={1}
        pathname="/executions"
        params={{}}
      />
    );

    const headline = screen.getByRole("link", { name: "Execution purpose 1" });
    expect(headline.getAttribute("href")).toBe("/executions/execution-1");
    expect(screen.getByText("TC-FIX-0001")).toBeTruthy();
  });

  it("falls back to the stage a run has actually reached", () => {
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeExecutionRows(1, { state: "PLANNED" })}
        total={1}
        page={1}
        pathname="/executions"
        params={{}}
      />
    );

    // Never started, so there is no start to report — the row says when it was planned
    // rather than leaving a blank where a timestamp would go.
    expect(screen.getByText(/· Planned$/)).toBeTruthy();
    expect(screen.getByText("2026-01-05 09:00")).toBeTruthy();
  });

  /**
   * The Jira issue key on the row.
   *
   * Text, never a link, even though the detail page links the same key: the row's one click
   * target is its title, which is why the row is not a stretched link and why "View" is
   * skipped in the tab order. An external anchor per row duplicates no destination, so it
   * could not be hidden the same way — 50 rows would become 50 extra tab stops to serve the
   * rarer intention.
   */
  it("names the Jira issue a run is testing, as text rather than a link", () => {
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeExecutionRows(1, { jiraIssueKey: "PROJ-123" })}
        total={1}
        page={1}
        pathname="/executions"
        params={{}}
        jiraConfigured
      />
    );

    expect(metaLine()).toMatch(/· PROJ-123$/);
    expect(screen.queryByRole("link", { name: /PROJ-123/ })).toBeNull();
  });

  it("says so when a run carries no issue key", () => {
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeExecutionRows(1)}
        total={1}
        page={1}
        pathname="/executions"
        params={{}}
        jiraConfigured
      />
    );
    expect(metaLine()).toMatch(/· No Jira issue$/);
  });

  /**
   * Q13(b): where no `JIRA_*` configuration exists, no run could ever be linked, so "No Jira
   * issue" would report the deployment's config rather than anything about the run — on every
   * row, forever.
   */
  it("stays silent about an absent key where the deployment has no Jira", () => {
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }} rows={makeExecutionRows(1)} total={1} page={1} pathname="/executions" params={{}} />
    );
    expect(metaLine()).not.toMatch(/No Jira issue/);
  });

  /** A key recorded before (or without) any Jira configuration is still a fact of the run. */
  it("still shows a recorded key where the deployment has no Jira", () => {
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeExecutionRows(1, { jiraIssueKey: "PROJ-123" })}
        total={1}
        page={1}
        pathname="/executions"
        params={{}}
      />
    );
    expect(metaLine()).toMatch(/· PROJ-123$/);
  });

  it("offers products as a dropdown and keeps the choice when the state chip changes", () => {
    nav.search = "product=prod-1";
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeExecutionRows(3)}
        total={3}
        page={1}
        pathname="/executions"
        params={{ product: "prod-1" }}
        products={[
          { id: "prod-1", businessId: "PROD001", name: "Storefront" },
          { id: "prod-2", businessId: "PROD002", name: "Back office" }
        ]}
      />
    );

    const select = screen.getByLabelText("Filter by product") as HTMLSelectElement;
    expect(select.value).toBe("prod-1");
    expect(screen.getByRole("option", { name: "PROD001 · Storefront" })).toBeTruthy();
    // The two filters compose: narrowing by state must not silently drop the product.
    expect(href("Finalized")).toBe("/executions?product=prod-1&state=FINALIZED");
  });

  /** One product is still a product: see the note in `case-table.tsx`. */
  it("offers the product filter when the catalogue holds a single product", () => {
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeExecutionRows(3)}
        total={3}
        page={1}
        pathname="/executions"
        params={{}}
        products={[{ id: "prod-1", businessId: "PROD001", name: "Storefront" }]}
      />
    );

    expect(screen.getByLabelText("Filter by product")).toBeTruthy();
    expect(screen.getByRole("option", { name: "PROD001 · Storefront" })).toBeTruthy();
  });

  it("leaves the product filter off entirely when no products are passed", () => {
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeExecutionRows(3)}
        total={3}
        page={1}
        pathname="/executions"
        params={{}}
      />
    );
    expect(screen.queryByLabelText("Filter by product")).toBeNull();
  });

  it("offers a feature filter alongside the product filter, and composes with the state chip", () => {
    nav.search = "product=prod-1&feature=feat-1";
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeExecutionRows(3)}
        total={3}
        page={1}
        pathname="/executions"
        params={{ product: "prod-1", feature: "feat-1" }}
        products={[{ id: "prod-1", businessId: "PROD001", name: "Storefront" }]}
        features={[{ id: "feat-1", businessId: "FEAT001", name: "Card payment" }]}
      />
    );

    const select = screen.getByLabelText("Filter by feature") as HTMLSelectElement;
    expect(select.value).toBe("feat-1");
    expect(screen.getByRole("option", { name: "FEAT001 · Card payment" })).toBeTruthy();
    // All three filters compose: narrowing by state must not silently drop the others.
    expect(href("Finalized")).toBe("/executions?product=prod-1&feature=feat-1&state=FINALIZED");
  });

  it("leaves the feature filter off entirely when no features are passed", () => {
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeExecutionRows(3)}
        total={3}
        page={1}
        pathname="/executions"
        params={{}}
      />
    );
    expect(screen.queryByLabelText("Filter by feature")).toBeNull();
  });

  it("separates an empty list from an empty filter result", () => {
    const { unmount } = render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }} rows={[]} total={0} page={1} pathname="/executions" params={{}} />
    );
    expect(
      screen.getByText("No executions yet. Plan one against an approved test case.")
    ).toBeTruthy();
    unmount();

    nav.search = "state=FINALIZED";
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }}
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

  /** The defect meta line, which carries the case ID, priority, severity and Jira key. */
  const defectMeta = () => screen.getByText(/High priority/).textContent;

  /**
   * Text, never a link, on the same reasoning as the executions list above: the row's one
   * click target is its summary, and the detail page one click away links the key.
   */
  it("names the Jira bug raised for a defect, as text rather than a link", () => {
    render(
      <DefectList
        rows={makeDefectRows(1, { jiraIssueKeys: true })}
        total={1}
        page={1}
        pathname="/defects"
        params={{}}
        jiraConfigured
      />
    );

    expect(defectMeta()).toMatch(/· JIRA-0001$/);
    expect(screen.queryByRole("link", { name: /JIRA-0001/ })).toBeNull();
  });

  /**
   * "Not raised in Jira", never "No Jira issue" — the wording a run uses. A run legitimately
   * has no issue because nobody typed one; a defect whose product raises bugs has none only
   * because QAMS did not manage to. The two absences mean opposite things.
   */
  it("says a defect was not raised when its product raises bugs and it has none", () => {
    render(
      <DefectList
        rows={makeDefectRows(1, { jiraExpected: true })}
        total={1}
        page={1}
        pathname="/defects"
        params={{}}
        jiraConfigured
      />
    );
    expect(defectMeta()).toMatch(/· Not raised in Jira$/);
  });

  /**
   * The per-product switch. A product with no Jira project key was never meant to raise
   * anything, so reporting "not raised" would name a fault where there is none — on every one
   * of that product's defects, forever. This is the row-level half of the question;
   * `jiraConfigured` is the deployment-level half.
   */
  it("stays silent when the defect's product raises no bugs", () => {
    render(
      <DefectList
        rows={makeDefectRows(1, { jiraExpected: false })}
        total={1}
        page={1}
        pathname="/defects"
        params={{}}
        jiraConfigured
      />
    );
    expect(defectMeta()).not.toMatch(/Jira/);
  });

  it("stays silent about an absent key where the deployment has no Jira", () => {
    render(
      <DefectList
        rows={makeDefectRows(1, { jiraExpected: true })}
        total={1}
        page={1}
        pathname="/defects"
        params={{}}
      />
    );
    expect(defectMeta()).not.toMatch(/Jira/);
  });

  /** A bug raised before the product's project key was cleared is still a fact of the defect. */
  it("still shows a raised key after its product stopped raising bugs", () => {
    render(
      <DefectList
        rows={makeDefectRows(1, { jiraIssueKeys: true, jiraExpected: false })}
        total={1}
        page={1}
        pathname="/defects"
        params={{}}
      />
    );
    expect(defectMeta()).toMatch(/· JIRA-0001$/);
  });

  it("offers the product filter, and commits a choice back to page 1", () => {
    nav.search = "page=4";
    nav.pathname = "/defects";
    render(
      <DefectList
        rows={makeDefectRows(50)}
        total={60}
        page={4}
        pathname="/defects"
        params={{ page: "4" }}
        products={[
          { id: "prod-1", businessId: "PROD001", name: "Storefront" },
          { id: "prod-2", businessId: "PROD002", name: "Back office" }
        ]}
      />
    );

    fireEvent.change(screen.getByLabelText("Filter by product"), {
      target: { value: "prod-1" }
    });
    expect(nav.replace).toHaveBeenCalledWith("/defects?product=prod-1", { scroll: false });
  });

  it("names the product when it is the filter that emptied the list", () => {
    nav.search = "product=prod-2";
    render(
      <DefectList
        rows={[]}
        total={0}
        page={1}
        pathname="/defects"
        params={{ product: "prod-2" }}
        products={[{ id: "prod-2", businessId: "PROD002", name: "Back office" }]}
      />
    );

    // Not "no defects recorded" — there are 60 of them, none against this product.
    expect(screen.getByText("No defect has been raised against this product.")).toBeTruthy();
    expect(screen.queryByText("No defects recorded.")).toBeNull();
    // And the filter that emptied it survives, or there is no way left to clear it.
    expect((screen.getByLabelText("Filter by product") as HTMLSelectElement).value).toBe("prod-2");
  });

  it("leaves the product filter off the defects list when no products are passed", () => {
    render(
      <DefectList rows={makeDefectRows(50)} total={60} page={1} pathname="/defects" params={{}} />
    );
    expect(screen.queryByLabelText("Filter by product")).toBeNull();
  });
});

/**
 * A page past the end of the list.
 *
 * `readPage` does not clamp and `Pager` clamps for display only, so an offset beyond the
 * last row returns zero rows while `total` stays positive. Every list used to attribute
 * that to the filters: the defect list rendered `Nothing matches “”.` — with visibly
 * empty quotes — and the executions list blamed filters that were not set, both directly
 * above a pager honestly reporting "Showing 1–50 of 60".
 *
 * Reachable without touching a URL: hold page 2 of a queue while colleagues work it down
 * to a single page.
 */
describe("a page past the end of the list", () => {
  it("says so on the executions list rather than blaming a filter", () => {
    nav.search = "";
    render(
      <ExecutionList stampFormat={{ timeZone: "UTC", clock: "h23" }} rows={[]} total={60} page={9} pathname="/executions" params={{ page: "9" }} />
    );

    expect(screen.getByText("This page is past the end of the list.")).toBeTruthy();
    expect(screen.queryByText("No execution matches the current filters.")).toBeNull();
    // The pager's Previous/Next are computed from the clamped page, so they point back
    // into the same empty view. This link is the only way out.
    expect(screen.getByRole("link", { name: "Go to the first page" }).getAttribute("href")).toBe(
      "/executions"
    );
  });

  it("says so on the defects list instead of quoting an empty needle", () => {
    nav.search = "";
    render(<DefectList rows={[]} total={60} page={9} pathname="/defects" params={{ page: "9" }} />);

    expect(screen.getByText("This page is past the end of the list.")).toBeTruthy();
    expect(screen.queryByText("Nothing matches “”.")).toBeNull();
  });

  it("keeps the other filters when returning to page 1", () => {
    nav.search = "q=login";
    render(
      <DefectList
        rows={[]}
        total={60}
        page={9}
        pathname="/defects"
        params={{ q: "login", page: "9" }}
      />
    );

    // Dropping the needle as well would silently widen the list the viewer had narrowed.
    expect(screen.getByRole("link", { name: "Go to the first page" }).getAttribute("href")).toBe(
      "/defects?q=login"
    );
  });
});
