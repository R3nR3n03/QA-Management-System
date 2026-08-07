import Link from "next/link";
import { ChevronRight, CircleDot, Component, Folder, Package } from "lucide-react";
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
 * The hierarchy as a tree: Product → Module → Feature → Requirement, with a child count
 * on every row that has children.
 *
 * A server component. There is no state to hold — which branches are open and what is
 * selected both live in the query string (`selection.ts`) — so the rows themselves ship no
 * JavaScript and work before hydration. Keyboard navigation is a client controller wrapped
 * around them (`TreeKeyboard`), not a rewrite of them: it moves focus and follows links, so
 * the tree degrades to a working set of links.
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
 * The requirement level is affordable only because the fetch is lazy: at most one
 * feature's worth is ever loaded (`listCatalogueTree`). Their labels are sentences, so
 * they truncate here and are read in full in the detail panel.
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
  feature: Component,
  requirement: CircleDot
} as const;

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
  // selection is not on screen (a search can filter it out), in which case the first row
  // does, so the tree is never a widget with no way in.
  const tabStop = selectedIsRendered(tree, selected)
    ? null
    : (tree.products[0]?.businessId ?? null);

  return (
    <TreeKeyboard>
    <ul className="cat-tree" role="tree" aria-label="Product, module, feature and requirement hierarchy">
      {tree.products.map((product, index) => (
        <TreeNode
          key={product.id}
          kind="product"
          level={1}
          position={index + 1}
          setSize={tree.products.length}
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
              setSize={product.modules?.length ?? 0}
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
                  setSize={moduleRow.features?.length ?? 0}
                  businessId={feature.businessId}
                  name={feature.name}
                  count={feature.requirementCount}
                  open={feature.requirements !== null}
                  selected={selected}
                  tabStop={tabStop}
                  params={params}
                >
                  {feature.requirements?.map((requirement, requirementIndex) => (
                    <TreeNode
                      key={requirement.id}
                      kind="requirement"
                      level={4}
                      position={requirementIndex + 1}
                      setSize={feature.requirements?.length ?? 0}
                      businessId={requirement.businessId}
                      name={requirement.name}
                      count={null}
                      open={null}
                      selected={selected}
                      tabStop={tabStop}
                      params={params}
                    />
                  ))}
                </TreeNode>
              ))}
            </TreeNode>
          ))}
        </TreeNode>
      ))}
    </ul>
    </TreeKeyboard>
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
  kind: SelectionKind;
  level: number;
  position: number;
  setSize: number;
  businessId: string;
  name: string;
  /** `null` for a leaf, which has nothing to count. */
  count: number | null;
  /** `null` for a level that cannot expand — a requirement. */
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
   * A row is expandable only if there is something behind the chevron. A requirement is a
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
      >
        {expandable ? (
          <Link
            href={toggleOpenHref(params, businessId)}
            className="cat-twist-btn"
            // Not a tab stop: the tree is ONE stop in the tab order, and that stop is the
            // row. The chevron is reached with `→`/`←`, which is what the ARIA tree
            // pattern asks for anyway.
            tabIndex={-1}
            aria-label={`${open ? "Collapse" : "Expand"} ${businessId} ${name}`}
            data-twist={businessId}
          >
            <ChevronRight size={14} aria-hidden className={`cat-twist${open ? " cat-twist-open" : ""}`} />
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
      {children ? <ul role="group">{children}</ul> : null}
    </li>
  );
}

/**
 * Is the selected record actually one of the rows on screen?
 *
 * It usually is, but a search can filter it out — the selection survives a search by
 * design. When it does, no row would carry `aria-selected` and the tab stop has to fall
 * back to the first row, or the tree becomes a widget with no way into it.
 */
function selectedIsRendered(tree: Tree, selected: Selection | null): boolean {
  if (selected === null) return false;
  for (const product of tree.products) {
    if (selected.kind === "product" && product.businessId === selected.businessId) return true;
    for (const moduleRow of product.modules ?? []) {
      if (selected.kind === "module" && moduleRow.businessId === selected.businessId) return true;
      for (const feature of moduleRow.features ?? []) {
        if (selected.kind === "feature" && feature.businessId === selected.businessId) return true;
        for (const requirement of feature.requirements ?? []) {
          if (selected.kind === "requirement" && requirement.businessId === selected.businessId) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function childWord(kind: SelectionKind, count: number): string {
  const noun = kind === "product" ? "module" : kind === "module" ? "feature" : "requirement";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
