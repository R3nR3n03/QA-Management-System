import Link from "next/link";
import { ChevronRight, CircleDot, Component, Folder, Package } from "lucide-react";
import type { CatalogueTree as Tree } from "@/domain/catalogue-tree";
import type { ListSearchParams } from "@/ui/list-params";
import { isSelected, selectionHref, type Selection, type SelectionKind } from "./selection";

/**
 * The hierarchy as a tree: Product → Module → Feature → Requirement, with a child count
 * on every row that has children.
 *
 * A server component. There is no state to hold — which branches are open follows from
 * what is selected, and what is selected lives in the query string (`selection.ts`) — so
 * this ships no JavaScript and works before hydration. Keyboard navigation turns it into
 * a client island later; nothing here has to move for that.
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
  return (
    <ul className="cat-tree" role="tree" aria-label="Product, module and feature hierarchy">
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
          params={params}
          parent={null}
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
              params={params}
              parent={{ kind: "product", businessId: product.businessId }}
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
                  params={params}
                  parent={{ kind: "module", businessId: moduleRow.businessId }}
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
                      params={params}
                      parent={{ kind: "feature", businessId: feature.businessId }}
                    />
                  ))}
                </TreeNode>
              ))}
            </TreeNode>
          ))}
        </TreeNode>
      ))}
    </ul>
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
  params,
  parent,
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
  params: ListSearchParams | undefined;
  parent: Selection | null;
  children?: React.ReactNode;
}) {
  const Icon = ICON_BY_KIND[kind];
  const here = isSelected(selected, kind, businessId);

  /**
   * Clicking the node that is already selected AND open goes to its parent, which closes
   * it — the row is the toggle, because opening a branch is a fetch and therefore a
   * navigation (see the `.cat-twist` note in globals.css). A product opened only because a
   * descendant is selected is NOT selected itself, so clicking it selects it rather than
   * collapsing the branch the viewer is working in.
   */
  const href =
    here && open === true
      ? selectionHref(params, parent)
      : selectionHref(params, { kind, businessId });

  return (
    <li role="none">
      <Link
        href={href}
        className="cat-node"
        role="treeitem"
        aria-level={level}
        aria-setsize={setSize}
        aria-posinset={position}
        aria-selected={here}
        aria-expanded={open === null ? undefined : open}
        // One indent step per level, read by the padding rule.
        style={{ ["--cat-level" as string]: level - 1 }}
        title={`${businessId} · ${name}`}
      >
        <ChevronRight
          size={14}
          aria-hidden
          className={`cat-twist${open === null ? " cat-twist-leaf" : open ? " cat-twist-open" : ""}`}
        />
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
      {children ? <ul role="group">{children}</ul> : null}
    </li>
  );
}

function childWord(kind: SelectionKind, count: number): string {
  const noun = kind === "product" ? "module" : kind === "module" ? "feature" : "requirement";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
