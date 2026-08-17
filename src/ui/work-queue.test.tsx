// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

/**
 * The scope dropdowns and the refresh control are client islands inside this otherwise
 * server-rendered component, so the queue cannot render at all without the navigation
 * hooks. `pathname` is settable because the dropdowns build their destination from
 * `usePathname()`, NOT from the `pathname` prop the server passes for its links.
 */
const nav = vi.hoisted(() => ({
  search: "",
  pathname: "/my-work",
  replace: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: nav.refresh }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search)
}));

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

import { FinalizedRecap, readWorkTab, WorkQueue, type FinalizedRowData, type WorkRowData } from "./work-queue";

/**
 * The My work queue — presentation only, no domain involvement. It renders exactly the
 * page it is handed, so the assertions are about the links it builds and the words it
 * chooses: the tab hrefs (which must drop the page key), the CTA verb (which must follow
 * the run's state), and the empty sentence (which must name the filter that emptied it).
 *
 * Every asserted string is the exact shipped wording. A mismatch means the TEST is
 * wrong, never the component copy.
 */

/* Fixed instants, never `new Date()`: rendered stamps are asserted by exact string. */
const PLANNED_AT = new Date("2026-01-05T09:00:00.000Z");
const STARTED_AT = new Date("2026-01-06T10:30:00.000Z");
const FINALIZED_AT = new Date("2026-01-07T14:45:00.000Z");

const pad = (n: number) => String(n).padStart(4, "0");

function makeWorkRows(
  count: number,
  state: WorkRowData["state"] = "PLANNED",
  jiraIssueKey: string | null = null
): WorkRowData[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `execution-${n}`,
      businessId: `EXE-${pad(n)}`,
      state,
      caseBusinessIds: [`TC-FIX-${pad(n)}`],
      purpose: `Execution purpose ${n}`,
      priority: "High",
      jiraIssueKey,
      plannedAt: PLANNED_AT,
      startedAt: state === "IN_PROGRESS" ? STARTED_AT : null
    };
  });
}

function makeFinalizedRows(
  count: number,
  overrides: Partial<FinalizedRowData> = {}
): FinalizedRowData[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `execution-${n}`,
      businessId: `EXE-${pad(n)}`,
      result: "FAIL" as const,
      caseBusinessIds: [`TC-FIX-${pad(n)}`],
      purpose: `Finalized purpose ${n}`,
      jiraIssueKey: null,
      caseResults: ["FAIL" as const],
      finalizedAt: FINALIZED_AT,
      ...overrides
    };
  });
}

const COUNTS = { open: 3, planned: 2, inProgress: 1 };

const PRODUCTS = [{ id: "prod-1", businessId: "PRD001", name: "Portal" }];
const FEATURES = [{ id: "feat-1", businessId: "FEA001", name: "Upload" }];

const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

afterEach(cleanup);
beforeEach(() => {
  nav.search = "";
  nav.pathname = "/my-work";
  nav.replace.mockClear();
  nav.refresh.mockClear();
});

describe("WorkQueue", () => {
  it("names the next move per row: Start for a planned run, Continue for one in progress", () => {
    render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={[...makeWorkRows(1, "PLANNED"), ...makeWorkRows(1, "IN_PROGRESS")]}
        total={2}
        counts={COUNTS}
        page={1}
        pathname="/my-work"
        params={{}}
      />
    );

    // Both fixtures are EXE-0001; the labels are what distinguish the two controls.
    expect(screen.getByRole("link", { name: "Start EXE-0001" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continue EXE-0001" })).toBeTruthy();
    // The chip still carries the state in words beside the decorative mark. Two matches:
    // the row's chip and the tab of the same name.
    expect(screen.getAllByText("In Progress")).toHaveLength(2);
  });

  it("tabs carry their tally, mark the current one, and reset the page", () => {
    render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeWorkRows(2)}
        total={2}
        counts={COUNTS}
        page={4}
        pathname="/my-work"
        params={{ page: "4", q: "login" }}
      />
    );

    // Page 4 of the open queue; switching tabs must go back to page 1 and keep the
    // needle — a shorter filtered list would otherwise land on nothing.
    expect(href("Planned 2")).toBe("/my-work?q=login&state=PLANNED");
    expect(href("In Progress 1")).toBe("/my-work?q=login&state=IN_PROGRESS");
    // "All runs" is the absence of the filter, not a value of it.
    expect(href("All runs 3")).toBe("/my-work?q=login");
    expect(screen.getByRole("link", { name: "All runs 3" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: "Planned 2" }).getAttribute("aria-current")).toBe(null);
  });

  it("marks the tab the URL asks for", () => {
    render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeWorkRows(1, "IN_PROGRESS")}
        total={1}
        counts={COUNTS}
        page={1}
        pathname="/my-work"
        params={{ state: "IN_PROGRESS" }}
      />
    );

    expect(screen.getByRole("link", { name: "In Progress 1" }).getAttribute("aria-current")).toBe("true");
  });

  it("pages from the server's total with the rows it was handed", () => {
    render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeWorkRows(25)}
        total={72}
        counts={{ open: 72, planned: 72, inProgress: 0 }}
        page={1}
        pageSize={25}
        pathname="/my-work"
        params={{}}
      />
    );

    expect(screen.getByText("Showing 1–25 of 72")).toBeTruthy();
    expect(screen.getByText("72 runs")).toBeTruthy();
    expect(href("Next")).toBe("/my-work?page=2");
  });

  it("names the filter that emptied the queue", () => {
    const { rerender } = render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={[]}
        total={0}
        counts={{ open: 0, planned: 0, inProgress: 0 }}
        page={1}
        pathname="/my-work"
        params={{ q: "login" }}
      />
    );
    expect(screen.getByText("No run of yours matches “login”.")).toBeTruthy();

    rerender(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={[]}
        total={0}
        counts={{ open: 0, planned: 0, inProgress: 0 }}
        page={1}
        pathname="/my-work"
        params={{ state: "PLANNED" }}
      />
    );
    expect(screen.getByText("Nothing planned is waiting on you.")).toBeTruthy();

    rerender(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={[]}
        total={0}
        counts={{ open: 0, planned: 0, inProgress: 0 }}
        page={1}
        pathname="/my-work"
        params={{}}
      />
    );
    // Nothing assigned at all is not a dead end: the way out is a real link.
    expect(href("Browse all executions")).toBe("/executions");
  });

  it("offers the catalogue scopes, and picking one returns to page 1", () => {
    nav.search = "page=3";
    render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeWorkRows(2)}
        total={2}
        counts={COUNTS}
        page={3}
        pathname="/my-work"
        params={{ page: "3" }}
        products={PRODUCTS}
        features={FEATURES}
      />
    );

    fireEvent.change(screen.getByLabelText("Filter your runs by product"), {
      target: { value: "prod-1" }
    });
    // Narrowing while on page 3 would land on nothing: the scoped list is shorter.
    expect(nav.replace).toHaveBeenCalledWith("/my-work?product=prod-1", { scroll: false });
  });

  it("leaves a scope filter off the bar when the catalogue holds none", () => {
    render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeWorkRows(1)}
        total={1}
        counts={COUNTS}
        page={1}
        pathname="/my-work"
        params={{}}
        products={[]}
        features={[]}
      />
    );

    expect(screen.queryByLabelText("Filter your runs by product")).toBe(null);
    expect(screen.queryByLabelText("Filter your runs by feature")).toBe(null);
  });

  it("names the scope that emptied the queue, needle or not", () => {
    const { rerender } = render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={[]}
        total={0}
        counts={{ open: 0, planned: 0, inProgress: 0 }}
        page={1}
        pathname="/my-work"
        params={{ product: "prod-1" }}
        products={PRODUCTS}
      />
    );
    expect(screen.getByText("No run of yours covers this product.")).toBeTruthy();

    rerender(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={[]}
        total={0}
        counts={{ open: 0, planned: 0, inProgress: 0 }}
        page={1}
        pathname="/my-work"
        params={{ product: "prod-1", feature: "feat-1" }}
        products={PRODUCTS}
        features={FEATURES}
      />
    );
    expect(screen.getByText("No run of yours covers this product and feature.")).toBeTruthy();

    // Both kinds of filter at once: the sentence has to admit to both, or clearing the
    // needle alone looks like it should have brought rows back.
    rerender(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={[]}
        total={0}
        counts={{ open: 0, planned: 0, inProgress: 0 }}
        page={1}
        pathname="/my-work"
        params={{ q: "login", product: "prod-1" }}
        products={PRODUCTS}
      />
    );
    expect(screen.getByText("No run of yours matches “login” in this product.")).toBeTruthy();
  });

  it("refreshes the server data in place", () => {
    render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeWorkRows(1)}
        total={1}
        counts={COUNTS}
        page={1}
        pathname="/my-work"
        params={{}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh your work queue" }));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the Jira issue a run is testing, as text rather than a link", () => {
    render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeWorkRows(1, "PLANNED", "PROJ-412")}
        total={1}
        counts={COUNTS}
        page={1}
        pathname="/my-work"
        params={{}}
        jiraConfigured
      />
    );

    // The needle in the page header matches Jira keys, so a row returned by one has to say
    // so. Text and not an anchor: the row's one click target is its title.
    const key = screen.getByText("PROJ-412");
    expect(key.tagName).toBe("SPAN");
    expect(screen.queryByRole("link", { name: /PROJ-412/ })).toBe(null);
  });

  it("says a run has no Jira issue only where the deployment has Jira", () => {
    const { rerender } = render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeWorkRows(1)}
        total={1}
        counts={COUNTS}
        page={1}
        pathname="/my-work"
        params={{}}
        jiraConfigured
      />
    );
    expect(screen.getByText(/No Jira issue/)).toBeTruthy();

    // With no JIRA_* configuration no run could ever carry a key, so the words would be
    // reporting the deployment rather than the run — on every row, forever.
    rerender(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeWorkRows(1)}
        total={1}
        counts={COUNTS}
        page={1}
        pathname="/my-work"
        params={{}}
      />
    );
    expect(screen.queryByText(/No Jira issue/)).toBe(null);
  });

  it("says the page overshot rather than blaming a filter", () => {
    render(
      <WorkQueue stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={[]}
        total={9}
        counts={COUNTS}
        page={7}
        pageSize={25}
        pathname="/my-work"
        params={{ page: "7" }}
      />
    );
    expect(screen.getByText("This page is past the end of the list.")).toBeTruthy();
  });
});

describe("readWorkTab", () => {
  it("accepts only the two open states", () => {
    expect(readWorkTab({ state: "PLANNED" })).toBe("PLANNED");
    expect(readWorkTab({ state: "IN_PROGRESS" })).toBe("IN_PROGRESS");
  });

  it("falls back to the whole open queue for anything else", () => {
    // FINALIZED is a real lifecycle state, but not one this queue shows — a hand-typed
    // URL must land on the open queue, not on a permanently empty screen.
    expect(readWorkTab({ state: "FINALIZED" })).toBe("ALL");
    expect(readWorkTab({ state: "nonsense" })).toBe("ALL");
    expect(readWorkTab({})).toBe("ALL");
    expect(readWorkTab(undefined)).toBe("ALL");
  });
});

describe("FinalizedRecap", () => {
  it("renders nothing when the viewer has finalized nothing", () => {
    const { container } = render(<FinalizedRecap stampFormat={{ timeZone: "UTC", clock: "h23" }} rows={[]} total={0} />);
    expect(container.innerHTML).toBe("");
  });

  it("marks each row with the outcome its chip names", () => {
    const { container } = render(<FinalizedRecap stampFormat={{ timeZone: "UTC", clock: "h23" }} rows={makeFinalizedRows(1)} total={1} />);
    // The marker replaced the edge stripe; the chip still carries the word beside it, so
    // the outcome survives greyscale and colour-blindness either way.
    expect(container.querySelector('.work-mark[data-tone="fail"]')).toBeTruthy();
    expect(screen.getByText("Fail")).toBeTruthy();
    expect(screen.getByText("2026-01-07 14:45")).toBeTruthy();
  });

  it("names the run's cases and its Jira issue, like the queue above it", () => {
    render(
      <FinalizedRecap stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeFinalizedRows(1, { jiraIssueKey: "PROJ-77" })}
        total={1}
        jiraConfigured
      />
    );

    // The recap used to name no case at all: a finished run could be identified here only
    // by its own execution ID.
    expect(screen.getByText("TC-FIX-0001")).toBeTruthy();
    expect(screen.getByText("PROJ-77")).toBeTruthy();
  });

  it("breaks a multi-case run down, because one chip cannot say how many failed", () => {
    const { rerender } = render(
      <FinalizedRecap stampFormat={{ timeZone: "UTC", clock: "h23" }}
        rows={makeFinalizedRows(1, {
          caseBusinessIds: ["TC-FIX-0001", "TC-FIX-0002", "TC-FIX-0003"],
          caseResults: ["PASS", "FAIL", "PASS"]
        })}
        total={1}
      />
    );
    expect(screen.getByText(/\+2 more \(2 passed, 1 failed\)/)).toBeTruthy();

    // A single-case run needs none: its chip already IS the one case's result.
    rerender(<FinalizedRecap stampFormat={{ timeZone: "UTC", clock: "h23" }} rows={makeFinalizedRows(1)} total={1} />);
    expect(screen.queryByText(/failed\)/)).toBe(null);
  });

  it("states the cap only when it hides something", () => {
    const { rerender } = render(<FinalizedRecap stampFormat={{ timeZone: "UTC", clock: "h23" }} rows={makeFinalizedRows(8)} total={31} />);
    expect(screen.getByText(/Showing the 8 most recent of 31\./)).toBeTruthy();

    rerender(<FinalizedRecap stampFormat={{ timeZone: "UTC", clock: "h23" }} rows={makeFinalizedRows(3)} total={3} />);
    expect(screen.queryByText(/most recent of/)).toBe(null);
  });
});
