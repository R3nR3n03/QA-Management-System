import Link from "next/link";
import { ChevronRight, Component, Folder, MoreHorizontal, Package } from "lucide-react";
import type { CatalogueTree as Tree } from "@/domain/catalogue-tree";
import type { ListSearchParams } from "@/ui/list-params";
import {
  isSelected,
  selectionHref,
  toggleOpenHref,
  type Selection,
  type SelectionKind
} from "./selection";
import { TreeKeyboard } from "./TreeKeyboard";

/**
 * The hierarchy as a tree: Product → Module → Feature, with a child count on every row
 * that has children.
 *
 * A server component. There is no state to hold — which branches are open and what is
 * selected both live in the query string (`selection.ts`) — so the rows themselves ship no
 * JavaScript and work before hydration. Keyboard navigation is a client controller wrapped
 * around them (`TreeKeyboard`), not a rewrite of them: it moves focus and follows links, so
 * the tree degrades to a working set of links.
 *
 * ## Three levels, not four
 *
 * Requirements are not nodes here. They outnumber the other three levels several times
 * over and their label is a sentence, which a 300px column can only truncate into nothing.
 * They are read in the feature's detail panel, which pages them, and found through search,
 * which ranks and bounds them. `docs/adr/0001-catalogue-tree-stops-at-feature.md`.
 *
 * ## Every branch is bounded
 *
 * A branch draws at most `DEFAULT_CHILD_LIMIT` children and then says how many it is
 * holding back (`assembleTree`). The overflow row is a real tree item pointing at the
 * parent record, because the parent's panel is where a long child list is actually
 * readable — paged, with the timestamps and the edit affordance the tree has no room for.
 * Without it, one module with 400 features decides how big the whole tree is.
 *
 * ## Two links per row, not one
 *
 * The chevron is its own link (`?open=…`) and the row is another (`?sel=…`). They used to
 * be a single link that did both, and that is what made the tree look as though it would
 * not open: clicking a node that was already selected and open navigated to its parent in
 * order to close it, and a product has no parent, so the second click on a product cleared
 * the selection and returned to a bare `/catalogue`. Opening a product and then clicking it
 * again — the ordinary way anyone drills into a tree — opened it and shut it. Only one
 * branch could be open at a time for the same reason. See `OPEN_PARAM` in `selection.ts`.
 *
 * Siblings rather than one nested in the other, because an `<a>` inside an `<a>` is invalid
 * HTML; `.cat-row` is the flex box that puts them on one line.
 *
 * ## The ARIA contract
 *
 * `role="tree"` with `role="treeitem"` on each row and `role="group"` on each loaded
 * child list. Every row carries `aria-level`, `aria-setsize` and `aria-posinset`, which is
 * how the hierarchy reaches a screen reader — "Checkout, level 2, 4 of 12" is the
 * non-visual equivalent of the indentation, and this screen exists to make the hierarchy
 * legible. `aria-selected` rather than `aria-current`: this is a selection widget, and
 * there is only one page.
 *
 * The overflow row is a `treeitem` too, and it is counted in its siblings' `aria-setsize`.
 * A row the eye can see and the arrow keys move onto, that a screen reader is never told
 * about, is worse than no row.
 *
 * ## The single tab stop
 *
 * A tree is one stop in the tab order, not one per row — 900 rows must not be 900 Tabs.
 * The server renders `tabIndex={0}` on the selected row, or the first row when nothing is
 * selected, and `-1` on the rest; `TreeKeyboard` moves it from there with the arrow keys.
 * Rendering it server-side is what makes the tree keyboard-reachable before hydration
 * rather than a set of unreachable links.
 */

const ICON_BY_KIND = {
  product: Package,
  module: Folder,
  feature: Component
} as const;

/** The three levels the tree draws. A requirement is not one of them. */
type TreeKind = keyof typeof ICON_BY_KIND;

export function CatalogueTree({
  tree,
  selected,
  params
}: {
  tree: Tree;
  selected: Selection | null;
  params: ListSearchParams | undefined;
}) {
  // Which row holds the tree's one tab stop. The selected row owns it — unless the
  // selection is not on screen (a requirement is never a row; a capped branch can hold one
  // back), in which case the first row does, so the tree is never a widget with no way in.
  const tabStop = selectedIsRendered(tree, selected)
    ? null
    : (tree.products[0]?.businessId ?? null);

  // The overflow row counts as a sibling: it is focusable and it occupies a position.
  const rootSize = tree.products.length + (tree.hiddenProducts > 0 ? 1 : 0);

  return (
    <TreeKeyboard>
      <ul
        className="cat-tree"
        role="tree"
        aria-label="Product, module and feature hierarchy"
      >
        {tree.products.map((product, index) => (
          <TreeNode
            key={product.id}
            kind="product"
            level={1}
            position={index + 1}
            setSize={rootSize}
            businessId={product.businessId}
            name={product.name}
            count={product.moduleCount}
            open={product.modules !== null}
            selected={selected}
            tabStop={tabStop}
            params={params}
          >
            {product.modules?.map((moduleRow, moduleIndex) => (
              <TreeNode
                key={moduleRow.id}
                kind="module"
                level={2}
                position={moduleIndex + 1}
                setSize={siblingCount(product.modules, product.hiddenModules)}
                businessId={moduleRow.businessId}
                name={moduleRow.name}
                count={moduleRow.featureCount}
                open={moduleRow.features !== null}
                selected={selected}
                tabStop={tabStop}
                params={params}
              >
                {moduleRow.features?.map((feature, featureIndex) => (
                  <TreeNode
                    key={feature.id}
                    kind="feature"
                    level={3}
                    position={featureIndex + 1}
                    setSize={siblingCount(moduleRow.features, moduleRow.hiddenFeatures)}
                    businessId={feature.businessId}
                    name={feature.name}
                    count={feature.requirementCount}
                    // A feature is the leaf of the tree: nothing to expand, and no chevron
                    // promising there is.
                    open={null}
                    selected={selected}
                    tabStop={tabStop}
                    params={params}
                  />
                ))}
                <Overflow
                  hidden={moduleRow.hiddenFeatures}
                  noun="feature"
                  level={3}
                  siblings={siblingCount(moduleRow.features, moduleRow.hiddenFeatures)}
                  parent={{ kind: "module", businessId: moduleRow.businessId }}
                  params={params}
                />
              </TreeNode>
            ))}
            <Overflow
              hidden={product.hiddenModules}
              noun="module"
              level={2}
              siblings={siblingCount(product.modules, product.hiddenModules)}
              parent={{ kind: "product", businessId: product.businessId }}
              params={params}
            />
          </TreeNode>
        ))}
        {/* The root overflows too. There is no parent record to send anyone to, so it
            states the fact and points at the search box, which is the only thing that
            reaches past the cap at this level. */}
        {tree.hiddenProducts > 0 ? (
          <li role="none">
            <div className="cat-row" style={{ ["--cat-level" as string]: 0 }}>
              <span className="cat-twist-spacer" aria-hidden />
              <span
                className="cat-node cat-node-more"
                role="treeitem"
                aria-level={1}
                aria-setsize={rootSize}
                aria-posinset={rootSize}
                aria-selected={false}
                tabIndex={-1}
                data-node-id="more:root"
              >
                <MoreHorizontal size={14} aria-hidden style={{ flex: "none", opacity: 0.75 }} />
                <span>
                  {tree.hiddenProducts} more product{tree.hiddenProducts === 1 ? "" : "s"} — search
                  to reach them
                </span>
              </span>
            </div>
          </li>
        ) : null}
      </ul>
    </TreeKeyboard>
  );
}

/** Drawn children plus the overflow row, when there is one. */
function siblingCount(shown: unknown[] | null, hidden: number): number {
  return (shown?.length ?? 0) + (hidden > 0 ? 1 : 0);
}

/**
 * "+ 187 more features" — the last row of a branch the cap held back.
 *
 * A link to the PARENT record, not to a deeper page of the tree. The parent's detail panel
 * is the paged, timestamped, editable list; the tree's job is to show shape, and a branch
 * that has to scroll has stopped showing shape. Renders nothing when nothing is hidden.
 */
function Overflow({
  hidden,
  noun,
  level,
  siblings,
  parent,
  params
}: {
  hidden: number;
  noun: "module" | "feature";
  level: number;
  siblings: number;
  parent: { kind: TreeKind; businessId: string };
  params: ListSearchParams | undefined;
}) {
  if (hidden <= 0) return null;

  return (
    <li role="none">
      <div className="cat-row" style={{ ["--cat-level" as string]: level - 1 }}>
        <span className="cat-twist-spacer" aria-hidden />
        <Link
          href={selectionHref(params, { kind: parent.kind, businessId: parent.businessId })}
          className="cat-node cat-node-more"
          role="treeitem"
          aria-level={level}
          aria-setsize={siblings}
          aria-posinset={siblings}
          aria-selected={false}
          tabIndex={-1}
          data-node-id={`more:${parent.businessId}`}
          data-bid=""
          data-name=""
        >
          <MoreHorizontal size={14} aria-hidden style={{ flex: "none", opacity: 0.75 }} />
          <span>
            {hidden} more {noun}
            {hidden === 1 ? "" : "s"}
            <span className="sr-only"> — open {parent.businessId} to read the full list</span>
          </span>
        </Link>
      </div>
    </li>
  );
}

function TreeNode({
  kind,
  level,
  position,
  setSize,
  businessId,
  name,
  count,
  open,
  selected,
  tabStop,
  params,
  children
}: {
  kind: TreeKind;
  level: number;
  position: number;
  setSize: number;
  businessId: string;
  name: string;
  /** `null` for a level with nothing to count. */
  count: number | null;
  /** `null` for a level that cannot expand — a feature. */
  open: boolean | null;
  selected: Selection | null;
  /** Business ID of the row holding the tab stop when nothing is selected. */
  tabStop: string | null;
  params: ListSearchParams | undefined;
  children?: React.ReactNode;
}) {
  const Icon = ICON_BY_KIND[kind];
  const here = isSelected(selected, kind, businessId);

  /**
   * A row is expandable only if there is something behind the chevron. A feature is a
   * leaf (`open === null`), and so, in practice, is a module with no features: offering a
   * control that opens onto nothing is the same broken promise `TreeModule.features`
   * distinguishes `null` from `[]` to avoid.
   */
  const expandable = open !== null && (count ?? 0) > 0;

  return (
    <li role="none">
      <div
        className="cat-row"
        // One indent step per level. On the row, not the link, so the chevron sits in the
        // gutter the indent creates rather than pushing the label out of line with it.
        style={{ ["--cat-level" as string]: level - 1 }}
        // Only an OPEN branch pins itself while you scroll its children. A leaf's <li> is
        // one row tall, so sticking it would be a no-op with an opaque background for
        // nothing — and a closed branch has no children to lose track of. See the
        // `.cat-row[data-pin]` rule in globals.css.
        data-pin={open === true ? "" : undefined}
      >
        {expandable ? (
          <Link
            href={toggleOpenHref(params, businessId)}
            className="cat-twist-btn"
            // Deliberately NOT `prefetch`. Opening a branch is a navigation, so prefetching
            // is the obvious way to make it feel like a disclosure — and it is the wrong
            // one here. This page is `force-dynamic`, so a prefetch is a full server render,
            // and Next prefetches these on viewport entry rather than on hover: fifty
            // chevrons on screen would be fifty page renders to save one. The cost of the
            // click was cut at the source instead (see the query budget on `page.tsx`).
            // Not a tab stop: the tree is ONE stop in the tab order, and that stop is the
            // row. The chevron is reached with `→`/`←`, which is what the ARIA tree
            // pattern asks for anyway.
            tabIndex={-1}
            aria-label={`${open ? "Collapse" : "Expand"} ${businessId} ${name}`}
            data-twist={businessId}
          >
            <ChevronRight
              size={14}
              aria-hidden
              className={`cat-twist${open ? " cat-twist-open" : ""}`}
            />
          </Link>
        ) : (
          // Keeps every label on one vertical line whether or not the row can open.
          <span className="cat-twist-spacer" aria-hidden />
        )}
        <Link
          href={selectionHref(params, { kind, businessId })}
          className="cat-node"
          role="treeitem"
          aria-level={level}
          aria-setsize={setSize}
          aria-posinset={position}
          aria-selected={here}
          aria-expanded={expandable ? open === true : undefined}
          tabIndex={here || tabStop === businessId ? 0 : -1}
          data-node-id={businessId}
          data-bid={businessId}
          data-name={name}
          title={`${businessId} · ${name}`}
        >
          <Icon size={14} aria-hidden style={{ flex: "none", opacity: 0.75 }} />
          <span className="cat-node-id">{businessId}</span>
          <span className="cat-node-label">{name}</span>
          {/* The count is the row's own answer to "how big is this?", so it is read as part
              of the row rather than announced as a bare number after the name. */}
          {count === null ? null : (
            <span className="cat-count" data-zero={count === 0 ? "" : undefined}>
              <span className="sr-only">{childWord(kind, count)}</span>
              <span aria-hidden>{count}</span>
            </span>
          )}
        </Link>
      </div>
      {/*
        `open === true`, not `children` — the two stopped agreeing when the overflow row
        was added. A closed branch passes `[undefined, <Overflow/>]` as children: the map
        yields nothing and `Overflow` renders null, but the ARRAY is truthy, so a truthiness
        check put an empty `<ul role="group">` inside every collapsed node in the tree. The
        prop that means "this branch was fetched" is the one that decides whether it has a
        group, and it is already here.
      */}
      {open === true ? <ul role="group">{children}</ul> : null}
    </li>
  );
}

/**
 * Is the selected record actually one of the rows on screen?
 *
 * Often it is not: a requirement is never a tree row, and a capped branch can hold back
 * the very module that is selected. When it is not, no row carries `aria-selected` and the
 * tab stop has to fall back to the first row, or the tree becomes a widget with no way in.
 */
function selectedIsRendered(tree: Tree, selected: Selection | null): boolean {
  if (selected === null) return false;
  if (selected.kind === "requirement") return false;
  for (const product of tree.products) {
    if (selected.kind === "product" && product.businessId === selected.businessId) return true;
    for (const moduleRow of product.modules ?? []) {
      if (selected.kind === "module" && moduleRow.businessId === selected.businessId) return true;
      for (const feature of moduleRow.features ?? []) {
        if (selected.kind === "feature" && feature.businessId === selected.businessId) return true;
      }
    }
  }
  return false;
}

function childWord(kind: TreeKind, count: number): string {
  const noun = kind === "product" ? "module" : kind === "module" ? "feature" : "requirement";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
