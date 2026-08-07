"use client";

import { useEffect, useRef } from "react";

/**
 * Keyboard navigation for the catalogue tree (WAI-ARIA `tree` pattern).
 *
 * A controller, not a rewrite. The tree itself stays a server component — the rows are
 * links and the open branches follow the URL, so it renders and works with no JavaScript
 * at all. This wraps it, listens for keys, and moves focus. Nothing about the tree's
 * markup depends on hydration having happened.
 *
 * `display: contents` on the wrapper: `.cat-explorer` is a flex column whose scrolling
 * child must be the `<ul class="cat-tree">`, and a real box here would become that child
 * instead and break the panel's independent scroll. Events still bubble through an element
 * that generates no box.
 *
 * ## Two adaptations to the ARIA pattern, both forced by lazy loading
 *
 * A branch's children are fetched only when it opens, so opening one is a navigation.
 * That collapses two of the pattern's keys onto the same action:
 *
 * - **`→` on a closed node** navigates to it, which opens it — the same thing `Enter`
 *   does. On an OPEN node it moves focus to the first child, as the pattern says.
 * - **`←` on an open node** navigates to its parent, which closes it. Focus stays where it
 *   was, which is what the pattern asks for; the selection moves because in this tree
 *   "closed" and "the parent is selected" are the same state.
 *
 * - **`*` (expand all siblings) is not implemented.** Every expansion here is a server
 *   round trip, so expanding eight siblings would be eight navigations. A key that cannot
 *   do what its name says is worse than an absent one.
 *
 * `Enter` and `Space` additionally move focus to the detail panel: those two mean "show me
 * this", and leaving focus in the tree would change the whole right-hand side of the screen
 * with no indication to anyone not looking at it. The arrow keys deliberately do not — they
 * mean "look around", and focus belongs in the tree while you do.
 */

/** How long a type-ahead buffer survives between keystrokes. */
const TYPEAHEAD_MS = 600;

/** Focused after Enter/Space, so a selection is announced rather than silently swapped. */
const DETAIL_ID = "cat-detail";

export function TreeKeyboard({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  /** The node holding the tree's single tab stop. */
  const activeId = useRef<string | null>(null);
  const focusAfterRender = useRef<"tree" | "panel" | null>(null);
  const buffer = useRef("");
  const bufferTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Re-establish the roving tab stop after every render.
   *
   * Deliberately runs on every commit with no dependency array. The rows come from the
   * server, so their `tabindex` is not something this component can express as a prop —
   * it has to be applied to the DOM, and a server re-render (every selection, every
   * search keystroke) brings a fresh set of rows that needs it applied again. One
   * authoritative pass per commit is what keeps React's model and the DOM from drifting.
   */
  useEffect(() => {
    const items = treeItems(root.current);
    if (items.length === 0) {
      activeId.current = null;
      return;
    }

    const previous = activeId.current
      ? items.find((item) => item.dataset.nodeId === activeId.current)
      : undefined;
    const selected = items.find((item) => item.getAttribute("aria-selected") === "true");
    const target = previous ?? selected ?? items[0];

    // Exactly one tab stop: entering the tree is one Tab, leaving it is one Tab, however
    // many hundred rows are on screen.
    for (const item of items) item.tabIndex = item === target ? 0 : -1;
    activeId.current = target.dataset.nodeId ?? null;

    const mode = focusAfterRender.current;
    if (mode === null) return;
    focusAfterRender.current = null;

    if (mode === "panel") {
      const panel = document.getElementById(DETAIL_ID);
      if (panel) {
        panel.focus();
        return;
      }
    }
    focusItem(target);
  });

  useEffect(
    () => () => {
      if (bufferTimer.current) clearTimeout(bufferTimer.current);
    },
    []
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = treeItems(root.current);
    const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!current || items.length === 0) return;

    const index = items.indexOf(current);
    const level = levelOf(current);
    const expanded = current.getAttribute("aria-expanded");

    const go = (item: HTMLElement | undefined) => {
      if (!item) return;
      event.preventDefault();
      activeId.current = item.dataset.nodeId ?? null;
      for (const other of items) other.tabIndex = other === item ? 0 : -1;
      focusItem(item);
    };

    /** Follow the row's link, and say where focus should land once it re-renders. */
    const activate = (mode: "tree" | "panel") => {
      event.preventDefault();
      focusAfterRender.current = mode;
      current.click();
    };

    switch (event.key) {
      case "ArrowDown":
        // Collapsed branches are not rendered at all, so document order IS visible order.
        return go(items[index + 1]);
      case "ArrowUp":
        return go(items[index - 1]);
      case "Home":
        return go(items[0]);
      case "End":
        return go(items[items.length - 1]);

      case "ArrowRight":
        if (expanded === "false") return activate("tree");
        // An open node's first child is simply the next row.
        if (expanded === "true") return go(items[index + 1]);
        return; // a leaf has nowhere to go
      case "ArrowLeft":
        if (expanded === "true") return activate("tree");
        return go(findParent(items, index, level));

      case "Enter":
        return activate("panel");
      case " ":
      case "Spacebar":
        // Space would scroll the panel out from under the row it is activating.
        return activate("panel");

      default:
        if (isTypeAhead(event)) typeAhead(event.key);
        return;
    }

    function typeAhead(key: string) {
      event.preventDefault();
      buffer.current += key.toLowerCase();
      if (bufferTimer.current) clearTimeout(bufferTimer.current);
      bufferTimer.current = setTimeout(() => {
        buffer.current = "";
      }, TYPEAHEAD_MS);

      // One character typed repeatedly CYCLES through the rows beginning with it, rather
      // than accumulating into "ppp" and matching nothing. That is the ARIA pattern's
      // rule, and without it a second press of the same key looks broken.
      const typed = buffer.current;
      const repeated = typed.length > 1 && [...typed].every((c) => c === typed[0]);
      const needle = repeated ? typed[0] : typed;

      // Search forward from the current row and wrap, so a repeated key walks the matches
      // rather than sticking on the first one.
      const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
      const hit = ordered.find(
        (item) =>
          (item.dataset.bid ?? "").toLowerCase().startsWith(needle) ||
          (item.dataset.name ?? "").toLowerCase().startsWith(needle)
      );
      if (hit) go(hit);
    }
  };

  return (
    // The wrapper is not the widget — role and label live on the <ul> the tree renders.
    <div ref={root} style={{ display: "contents" }} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

function treeItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
}

function levelOf(item: HTMLElement): number {
  return Number(item.getAttribute("aria-level") ?? "1");
}

/** The nearest row above this one that sits a level shallower. */
function findParent(items: HTMLElement[], index: number, level: number): HTMLElement | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (levelOf(items[i]) === level - 1) return items[i];
  }
  return undefined;
}

function focusItem(item: HTMLElement) {
  item.focus();
  // The tree scrolls inside a fixed panel, so a row moved to by keyboard has to be
  // brought into view. `nearest` scrolls the minimum, rather than yanking the row to the
  // middle on every arrow press.
  item.scrollIntoView({ block: "nearest" });
}

/** A single printable character, unmodified — the only thing that starts a type-ahead. */
function isTypeAhead(event: React.KeyboardEvent): boolean {
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
}
