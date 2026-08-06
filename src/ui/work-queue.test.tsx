// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { vi } from "vitest";

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

function makeWorkRows(count: number, state: WorkRowData["state"] = "PLANNED"): WorkRowData[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `execution-${n}`,
      businessId: `EXE-${pad(n)}`,
      state,
      caseBusinessIds: [`TC-FIX-${pad(n)}`],
      caseTitle: `Execution title ${n}`,
      priority: "High",
      plannedAt: PLANNED_AT,
      startedAt: state === "IN_PROGRESS" ? STARTED_AT : null
    };
  });
}

function makeFinalizedRows(count: number): FinalizedRowData[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `execution-${n}`,
      businessId: `EXE-${pad(n)}`,
      result: "FAIL" as const,
      caseBusinessIds: [`TC-FIX-${pad(n)}`],
      caseTitle: `Finalized title ${n}`,
      finalizedAt: FINALIZED_AT
    };
  });
}

const COUNTS = { open: 3, planned: 2, inProgress: 1 };

const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

afterEach(cleanup);

describe("WorkQueue", () => {
  it("names the next move per row: Start for a planned run, Continue for one in progress", () => {
    render(
      <WorkQueue
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
      <WorkQueue
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
      <WorkQueue
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
      <WorkQueue
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
      <WorkQueue
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
      <WorkQueue
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
      <WorkQueue
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

  it("says the page overshot rather than blaming a filter", () => {
    render(
      <WorkQueue
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
    const { container } = render(<FinalizedRecap rows={[]} total={0} />);
    expect(container.innerHTML).toBe("");
  });

  it("stripes each row with the outcome its chip names", () => {
    const { container } = render(<FinalizedRecap rows={makeFinalizedRows(1)} total={1} />);
    expect(container.querySelector('[data-outcome="FAIL"]')).toBeTruthy();
    expect(screen.getByText("Fail")).toBeTruthy();
    expect(screen.getByText("2026-01-07 14:45 UTC")).toBeTruthy();
  });

  it("states the cap only when it hides something", () => {
    const { rerender } = render(<FinalizedRecap rows={makeFinalizedRows(8)} total={31} />);
    expect(screen.getByText(/Showing the 8 most recent of 31\./)).toBeTruthy();

    rerender(<FinalizedRecap rows={makeFinalizedRows(3)} total={3} />);
    expect(screen.queryByText(/most recent of/)).toBe(null);
  });
});
