// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

import { WorkRail, type RailAction, type WorkRailCounts } from "./work-rail";

/**
 * The My work side rail — presentation only. The assertions are about what it reports and
 * where its tiles lead, plus the one thing it must never render: a percentage.
 */

const COUNTS: WorkRailCounts = { planned: 3, inProgress: 1, finalized: 12, openCases: 33 };

const ACTIONS: RailAction[] = [
  { href: "/executions/new", label: "Plan a run", icon: "new-run" },
  { href: "/dashboard", label: "View dashboard", icon: "dashboard" }
];

const href = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href");

afterEach(cleanup);

describe("WorkRail", () => {
  it("reports the four counts, cases included", () => {
    render(<WorkRail counts={COUNTS} actions={ACTIONS} params={{}} />);

    // Three runs can be three cases or thirty-three; the tabs cannot tell them apart, which
    // is the whole reason this tile exists.
    expect(screen.getByText("33")).toBeTruthy();
    expect(screen.getByText("Cases to run")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("shows no percentage or grade of any kind", () => {
    const { container } = render(<WorkRail counts={COUNTS} actions={ACTIONS} params={{}} />);

    // `docs/business-rules-and-validation.md:39` — the knowledge base defines no percentage,
    // threshold or target, so a pass-rate tile would be a calculated policy. Asserted on the
    // rendered text rather than trusted to review, because the tempting thing to add to a
    // panel of tallies is exactly the thing that is forbidden here.
    expect(container.textContent).not.toMatch(/%/);
  });

  it("makes each tile a way into the rows it counts, keeping the current filters", () => {
    render(
      <WorkRail counts={COUNTS} actions={ACTIONS} params={{ product: "prod-1", page: "3" }} />
    );

    // The scope survives, so a tile clicked under a filter narrows rather than resets. The
    // page does not: a shorter slice would land on nothing.
    expect(href(/Planned/)).toBe("/my-work?product=prod-1&state=PLANNED");
    expect(href(/In Progress/)).toBe("/my-work?product=prod-1&state=IN_PROGRESS");
    // "Cases to run" covers both open states, which is the absence of the state filter.
    expect(href(/Cases to run/)).toBe("/my-work?product=prod-1");
    // The queue has no Finalized tab — those runs live on the executions screen.
    expect(href(/Finalized/)).toBe("/executions?state=FINALIZED");
  });

  it("renders only the shortcuts it was handed", () => {
    // The page filters these against the role/capability matrix, so a QA Tester arrives here
    // with no drafts or review entry at all rather than with links that would reject them.
    render(<WorkRail counts={COUNTS} actions={ACTIONS} params={{}} />);

    expect(screen.getByRole("link", { name: "Plan a run" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "My drafts" })).toBe(null);
    expect(screen.queryByRole("link", { name: "Review queue" })).toBe(null);
  });

  it("drops the shortcuts panel when there is nothing to put in it", () => {
    render(<WorkRail counts={COUNTS} actions={[]} params={{}} />);

    expect(screen.queryByRole("navigation", { name: "Quick actions" })).toBe(null);
    // The overview stays: it is the viewer's own work, which every role has.
    expect(screen.getByText("Work overview")).toBeTruthy();
  });

  it("carries the tip the server chose, and nothing when there is none", () => {
    const { rerender } = render(
      <WorkRail
        counts={COUNTS}
        actions={ACTIONS}
        params={{}}
        tip={{ id: "derived-result", title: "A run's result is its worst case", body: "…", basis: "x" }}
      />
    );
    expect(screen.getByText("A run's result is its worst case")).toBeTruthy();

    rerender(<WorkRail counts={COUNTS} actions={ACTIONS} params={{}} tip={null} />);
    expect(screen.queryByRole("region", { name: "Tip" })).toBe(null);
  });
});
