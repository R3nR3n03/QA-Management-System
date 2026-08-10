// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CatalogueTree as Tree } from "@/domain/catalogue-tree";

// `next/link` wants an App Router context that no unit test has. The tree's rows are
// anchors and their `href` is the whole contract, so an anchor is a faithful stand-in.
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

import { CatalogueTree } from "./CatalogueTree";

/**
 * The tree's structural contract, which is the half that has no visible failure mode.
 *
 * A wrong `href` shows up the moment anyone clicks. An empty `role="group"` inside every
 * collapsed node does not — it is invisible on screen and audible only to a screen reader,
 * and it is exactly what happened when the overflow row was added: a closed branch began
 * passing `[undefined, <Overflow/>]` as children, and the truthiness check that decided
 * whether to render the group saw a non-empty array.
 */

afterEach(cleanup);

const feature = (n: number, requirementCount = 0) => ({
  id: `f${n}`,
  businessId: `FEAT${String(n).padStart(3, "0")}`,
  name: `Feature ${n}`,
  requirementCount
});

const tree = (over: Partial<Tree> = {}): Tree => ({
  hiddenProducts: 0,
  products: [
    {
      id: "p1",
      businessId: "PROD001",
      name: "ServePOS",
      moduleCount: 2,
      modules: null,
      hiddenModules: 0
    }
  ],
  ...over
});

const opened = (over: { hiddenFeatures?: number; hiddenModules?: number } = {}): Tree =>
  tree({
    products: [
      {
        id: "p1",
        businessId: "PROD001",
        name: "ServePOS",
        moduleCount: 2,
        hiddenModules: over.hiddenModules ?? 0,
        modules: [
          {
            id: "m1",
            businessId: "MOD001",
            name: "Dashboard",
            featureCount: 4,
            hiddenFeatures: over.hiddenFeatures ?? 0,
            features: [feature(1, 3), feature(2)]
          }
        ]
      }
    ]
  });

const draw = (t: Tree) => render(<CatalogueTree tree={t} selected={null} params={{}} />);

describe("the group element", () => {
  // The regression. A closed node's <li> must contain the row and nothing else.
  it("gives a closed branch no group at all", () => {
    const { container } = draw(tree());
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(0);
  });

  it("gives an open branch a group holding its children", () => {
    const { container } = draw(opened());
    const groups = container.querySelectorAll('[role="group"]');
    // One for the product's modules, one for the module's features.
    expect(groups).toHaveLength(2);
    expect(within(groups[1] as HTMLElement).getAllByRole("treeitem")).toHaveLength(2);
  });

  // An open branch that really is empty is a different answer from a closed one, and the
  // empty state ("MOD001 has no features yet") depends on the difference surviving.
  it("gives an open but childless branch an empty group rather than none", () => {
    const { container } = draw(
      tree({
        products: [
          {
            id: "p1",
            businessId: "PROD001",
            name: "ServePOS",
            moduleCount: 0,
            modules: [],
            hiddenModules: 0
          }
        ]
      })
    );
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(1);
  });
});

describe("the levels it draws", () => {
  it("stops at feature — no chevron, and nothing under it", () => {
    const { container } = draw(opened());
    const leaf = screen.getByTitle("FEAT001 · Feature 1");

    expect(leaf.getAttribute("aria-level")).toBe("3");
    // A leaf states no expansion state at all; `false` would promise a chevron.
    expect(leaf.hasAttribute("aria-expanded")).toBe(false);
    expect(leaf.closest("li")?.querySelector('[role="group"]')).toBeNull();
    // ...even though it has requirements. They are read in the detail panel.
    expect(within(leaf).getByText("3")).toBeTruthy();
    expect(container.querySelectorAll(".cat-twist-btn")).toHaveLength(2);
  });

  it("pins only the branches that are open", () => {
    const { container } = draw(opened());
    const pinned = [...container.querySelectorAll(".cat-row[data-pin]")];
    // The product and the module. Not the two features, whose <li> is one row tall.
    expect(pinned).toHaveLength(2);
  });
});

describe("the overflow row", () => {
  it("is absent when the branch fits", () => {
    draw(opened());
    expect(screen.queryByText(/more feature/)).toBeNull();
  });

  it("says how many were held back and points at the parent record", () => {
    draw(opened({ hiddenFeatures: 187 }));
    const row = screen.getByText(/187 more features/).closest("a");
    expect(row?.getAttribute("href")).toContain("sel=m%3AMOD001");
  });

  it("agrees with itself in the singular", () => {
    draw(opened({ hiddenModules: 1 }));
    expect(screen.getByText(/1 more module\b/)).toBeTruthy();
  });

  // A row the eye can see and the arrow keys land on, that a screen reader is never told
  // about, is worse than no row: the set it belongs to has to count it.
  it("is a treeitem counted among its siblings", () => {
    draw(opened({ hiddenFeatures: 5 }));
    const overflow = screen.getByText(/5 more features/).closest('[role="treeitem"]');

    expect(overflow).not.toBeNull();
    expect(overflow?.getAttribute("aria-level")).toBe("3");
    // Two drawn features plus this row.
    expect(overflow?.getAttribute("aria-setsize")).toBe("3");
    expect(overflow?.getAttribute("aria-posinset")).toBe("3");
    expect(screen.getByTitle("FEAT001 · Feature 1").getAttribute("aria-setsize")).toBe("3");
  });

  // There is no parent record above the root, so this one states the fact instead of
  // offering a link that would go nowhere.
  it("states the root's overflow without linking", () => {
    draw(tree({ hiddenProducts: 12 }));
    const row = screen.getByText(/12 more products/);
    expect(row.closest("a")).toBeNull();
    expect(row.closest('[role="treeitem"]')).not.toBeNull();
  });
});

describe("the single tab stop", () => {
  it("puts it on the first row when nothing is selected", () => {
    const { container } = draw(opened());
    const stops = [...container.querySelectorAll('[role="treeitem"][tabindex="0"]')];
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute("data-bid")).toBe("PROD001");
  });

  it("moves it to the selected row", () => {
    const { container } = render(
      <CatalogueTree
        tree={opened()}
        selected={{ kind: "feature", businessId: "FEAT002" }}
        params={{}}
      />
    );
    const stops = [...container.querySelectorAll('[role="treeitem"][tabindex="0"]')];
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute("data-bid")).toBe("FEAT002");
  });

  // A requirement is never a row, so nothing on screen can carry the selection. The stop
  // has to fall back, or the tree becomes a widget with no way into it.
  it("falls back to the first row when the selection has no row", () => {
    const { container } = render(
      <CatalogueTree
        tree={opened()}
        selected={{ kind: "requirement", businessId: "REQ007" }}
        params={{}}
      />
    );
    const stops = [...container.querySelectorAll('[role="treeitem"][tabindex="0"]')];
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute("data-bid")).toBe("PROD001");
  });
});
