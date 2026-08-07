// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TreeKeyboard } from "./TreeKeyboard";

/**
 * Keyboard navigation over the catalogue tree.
 *
 * The controller is tested against a static fixture rather than the real `CatalogueTree`,
 * because what it operates on is the DOM contract — `role="treeitem"`, `aria-level`,
 * `aria-expanded`, and document order — not that component's props. Anything that keeps
 * the contract gets the same behaviour, and a change to either side that breaks the
 * contract fails here.
 *
 * The adaptation to the WAI-ARIA pattern is what most needs pinning down: opening a branch
 * is a navigation in this tree, so `→` and `←` follow the row's CHEVRON link — never the
 * row's own link, which would move the selection as a side effect of looking around.
 */

/**
 * PROD001            level 1, open
 *   MOD001           level 2, closed
 *   MOD002           level 2, open
 *     FEAT001        level 3, open
 *       REQ001       level 4, leaf
 *       REQ002       level 4, leaf
 *     FEAT002        level 3, closed
 * PROD002            level 1, closed
 */
const NODES: Array<{
  bid: string;
  name: string;
  level: number;
  /** undefined = a leaf, which carries no aria-expanded at all. */
  expanded?: boolean;
}> = [
  { bid: "PROD001", name: "Retail Banking", level: 1, expanded: true },
  { bid: "MOD001", name: "Onboarding", level: 2, expanded: false },
  { bid: "MOD002", name: "Checkout", level: 2, expanded: true },
  { bid: "FEAT001", name: "Card capture", level: 3, expanded: true },
  { bid: "REQ001", name: "A card number is validated", level: 4 },
  { bid: "REQ002", name: "An expired card is refused", level: 4 },
  { bid: "FEAT002", name: "3-D Secure", level: 3, expanded: false },
  { bid: "PROD002", name: "Wealth", level: 1, expanded: false }
];

// jsdom implements no layout, so HTMLElement has no scrollIntoView. Stubbed here rather
// than guarded in the component: it exists in every browser, and a component should not
// carry a branch that only the test environment can take.
HTMLElement.prototype.scrollIntoView = () => {};

/** Rows whose own link was followed — i.e. the selection moved. */
let clicks: string[] = [];
/** Branches whose chevron link was followed — i.e. the tree opened or closed. */
let twists: string[] = [];

function Fixture({ selected }: { selected?: string }) {
  return (
    <TreeKeyboard>
      <ul role="tree" aria-label="Hierarchy">
        {NODES.map((node) => (
          <li role="none" key={node.bid}>
            {/* Flat markup: the controller reads aria-level and document order, never
                the nesting. Real nesting is tested through the component that renders it.
                The `.cat-row` wrapper IS part of the contract, though — it is how the
                controller finds a row's chevron from the row itself. */}
            <div className="cat-row">
              {node.expanded === undefined ? null : (
                <a
                  className="cat-twist-btn"
                  href={`/catalogue?open=${node.bid}`}
                  tabIndex={-1}
                  aria-label={`${node.expanded ? "Collapse" : "Expand"} ${node.bid}`}
                  onClick={(event) => {
                    event.preventDefault();
                    twists.push(node.bid);
                  }}
                />
              )}
              <a
                role="treeitem"
                href={`/catalogue?sel=${node.bid}`}
                aria-level={node.level}
                aria-selected={selected === node.bid}
                aria-expanded={node.expanded}
                tabIndex={selected === node.bid ? 0 : -1}
                data-node-id={node.bid}
                data-bid={node.bid}
                data-name={node.name}
                onClick={(event) => {
                  event.preventDefault();
                  clicks.push(node.bid);
                }}
              >
                {node.bid} {node.name}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </TreeKeyboard>
  );
}

const item = (bid: string) => screen.getByText(new RegExp(`^${bid} `));
const focusedId = () => (document.activeElement as HTMLElement | null)?.dataset.nodeId;

/** Focus a row the way a viewer would arrive on it, then press a key. */
function press(from: string, key: string, init: Record<string, unknown> = {}) {
  const target = item(from);
  target.focus();
  return fireEvent.keyDown(target, { key, ...init });
}

beforeEach(() => {
  clicks = [];
  twists = [];
});
afterEach(cleanup);

describe("moving through the tree", () => {
  // Collapsed branches are not rendered at all, so document order IS visible order —
  // which is why crossing a level needs no special case.
  it("steps down and up across levels", () => {
    render(<Fixture />);
    press("PROD001", "ArrowDown");
    expect(focusedId()).toBe("MOD001");

    press("REQ002", "ArrowDown");
    expect(focusedId()).toBe("FEAT002");

    press("FEAT002", "ArrowUp");
    expect(focusedId()).toBe("REQ002");
  });

  it("stops at both ends rather than wrapping", () => {
    render(<Fixture />);
    press("PROD001", "ArrowUp");
    expect(focusedId()).toBe("PROD001");

    press("PROD002", "ArrowDown");
    expect(focusedId()).toBe("PROD002");
  });

  it("jumps to the first and last row", () => {
    render(<Fixture />);
    press("FEAT001", "End");
    expect(focusedId()).toBe("PROD002");

    press("FEAT001", "Home");
    expect(focusedId()).toBe("PROD001");
  });

  it("moves focus without following any link", () => {
    render(<Fixture />);
    press("PROD001", "ArrowDown");
    press("MOD001", "ArrowDown");
    expect(clicks).toEqual([]);
  });
});

describe("expanding and collapsing", () => {
  // The adaptation: a closed branch has not been fetched, so opening it is a navigation —
  // but to the chevron's `?open=`, NOT to the row's `?sel=`. Following the row here is the
  // bug this screen shipped with: `→` was then indistinguishable from Enter, and every
  // expansion dragged the selection along with it.
  it("follows the chevron, not the row, on ArrowRight at a closed node", () => {
    render(<Fixture />);
    press("MOD001", "ArrowRight");
    expect(twists).toEqual(["MOD001"]);
    expect(clicks).toEqual([]);
  });

  // On an open node it is a pure focus move, exactly as the pattern says.
  it("moves to the first child of an open node on ArrowRight", () => {
    render(<Fixture />);
    press("MOD002", "ArrowRight");
    expect(focusedId()).toBe("FEAT001");
    expect(twists).toEqual([]);
    expect(clicks).toEqual([]);
  });

  it("does nothing on ArrowRight at a leaf", () => {
    render(<Fixture />);
    press("REQ001", "ArrowRight");
    expect(focusedId()).toBe("REQ001");
    expect(twists).toEqual([]);
    expect(clicks).toEqual([]);
  });

  // Closing a branch is the chevron again. It used to select the PARENT, because "closed"
  // and "the parent is selected" were the same state; they are not any more, and `←` must
  // not move the selection to look around.
  it("follows the chevron, not the row, on ArrowLeft at an open node", () => {
    render(<Fixture />);
    press("FEAT001", "ArrowLeft");
    expect(twists).toEqual(["FEAT001"]);
    expect(clicks).toEqual([]);
  });

  it("moves to the parent from a closed node or a leaf", () => {
    render(<Fixture />);
    press("FEAT002", "ArrowLeft");
    expect(focusedId()).toBe("MOD002");
    expect(twists).toEqual([]);
    expect(clicks).toEqual([]);

    press("REQ001", "ArrowLeft");
    expect(focusedId()).toBe("FEAT001");
  });

  // The parent is the nearest row ABOVE that is one level shallower — not simply the
  // previous row, which for REQ002 would be a sibling.
  it("finds the parent by level, not by adjacency", () => {
    render(<Fixture />);
    press("REQ002", "ArrowLeft");
    expect(focusedId()).toBe("FEAT001");
  });

  it("does nothing on ArrowLeft at the root level", () => {
    render(<Fixture />);
    press("PROD002", "ArrowLeft");
    expect(focusedId()).toBe("PROD002");
    expect(clicks).toEqual([]);
  });
});

describe("activating a row", () => {
  it("follows the row on Enter", () => {
    render(<Fixture />);
    press("MOD002", "Enter");
    expect(clicks).toEqual(["MOD002"]);
  });

  // Space would otherwise scroll the panel out from under the row it is activating.
  it("follows the row on Space, and does not scroll", () => {
    render(<Fixture />);
    const prevented = !press("MOD002", " ");
    expect(clicks).toEqual(["MOD002"]);
    expect(prevented).toBe(true);
  });
});

describe("the roving tab stop", () => {
  // A tree is one stop in the tab order, not one per row.
  it("keeps exactly one tabbable row", () => {
    render(<Fixture />);
    const tabbable = () =>
      NODES.map((n) => item(n.bid)).filter((el) => el.getAttribute("tabindex") === "0");

    expect(tabbable()).toHaveLength(1);
    press("PROD001", "ArrowDown");
    expect(tabbable()).toHaveLength(1);
    expect(tabbable()[0].dataset.nodeId).toBe("MOD001");
  });

  it("starts on the selected row", () => {
    render(<Fixture selected="FEAT001" />);
    expect(item("FEAT001").getAttribute("tabindex")).toBe("0");
    expect(item("PROD001").getAttribute("tabindex")).toBe("-1");
  });

  // With nothing selected the first row has to hold it, or the tree is a widget with no
  // way into it from the keyboard.
  it("falls back to the first row when nothing is selected", () => {
    render(<Fixture />);
    expect(item("PROD001").getAttribute("tabindex")).toBe("0");
  });
});

describe("type-ahead", () => {
  it("jumps to the next row whose business ID starts with what was typed", () => {
    render(<Fixture />);
    press("PROD001", "f");
    expect(focusedId()).toBe("FEAT001");
  });

  it("matches on the name too", () => {
    render(<Fixture />);
    press("PROD001", "c");
    expect(focusedId()).toBe("MOD002"); // "Checkout"
  });

  // Repeating one key cycles the rows beginning with it — the ARIA rule. Without it the
  // buffer would accumulate to "pp", match nothing, and a second press would look broken.
  it("cycles through matches when the same key is repeated, wrapping at the end", () => {
    render(<Fixture />);
    press("FEAT002", "p");
    expect(focusedId()).toBe("PROD002");

    press("PROD002", "p");
    expect(focusedId()).toBe("PROD001");

    press("PROD001", "p");
    expect(focusedId()).toBe("PROD002");
  });

  it("accumulates keystrokes into one needle", () => {
    render(<Fixture />);
    const start = item("PROD001");
    start.focus();
    fireEvent.keyDown(start, { key: "m" });
    expect(focusedId()).toBe("MOD001");
    // "mod002" as a whole matches only the second module, though "m" alone matched the first.
    fireEvent.keyDown(item("MOD001"), { key: "o" });
    fireEvent.keyDown(document.activeElement!, { key: "d" });
    fireEvent.keyDown(document.activeElement!, { key: "0" });
    fireEvent.keyDown(document.activeElement!, { key: "0" });
    fireEvent.keyDown(document.activeElement!, { key: "2" });
    expect(focusedId()).toBe("MOD002");
  });

  it("stays put when nothing matches", () => {
    render(<Fixture />);
    press("PROD001", "z");
    expect(focusedId()).toBe("PROD001");
  });

  // A modified key belongs to the browser or to another shortcut, never to type-ahead.
  it("ignores modified keys", () => {
    render(<Fixture />);
    press("PROD001", "f", { metaKey: true });
    expect(focusedId()).toBe("PROD001");

    press("PROD001", "f", { ctrlKey: true });
    expect(focusedId()).toBe("PROD001");
  });
});
