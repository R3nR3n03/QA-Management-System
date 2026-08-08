import Link from "next/link";
import { ChevronRight, CircleDot, Component, Folder, Package } from "lucide-react";
import { highlight, type SearchHit, type SearchResults as Results } from "@/domain/catalogue-search";
import type { ListSearchParams } from "@/ui/list-params";
import { isSelected, selectionHref, type Selection, type SelectionKind } from "./selection";

/**
 * What the needle found: a flat, ranked list, best first.
 *
 * This is what the explorer shows INSTEAD of the tree while a search is running. It is not
 * a filtered tree, and that is the point — see
 * `docs/adr/0002-catalogue-search-is-a-flat-ranked-list.md`. The tree used to be filtered
 * in place: every match dragged its ancestors on screen and every surviving branch was
 * force-expanded, which reads beautifully at thirty records and becomes a wall of
 * half-truncated rows at three thousand.
 *
 * Each row carries its own ancestry on a second line — `PROD001 › MOD004 › FEAT012` — which
 * is the same information the expanded branches existed to convey, in one line instead of
 * four rows, and legible at any depth. A requirement is a first-class result here; it is
 * the one place in the explorer where the whole statement is worth showing, because it is
 * what was searched.
 *
 * A server component: rows are links, the needle is in the URL, nothing to hydrate.
 *
 * ## Not a tree
 *
 * `role="list"`, deliberately. Announcing a flat result set as a `tree` would promise
 * levels, expansion and arrow-key traversal that are not there. `TreeKeyboard` does not
 * wrap this, so each row is its own tab stop — correct for a short, bounded list, and the
 * reason the list IS bounded.
 */

const ICON_BY_KIND = {
  product: Package,
  module: Folder,
  feature: Component,
  requirement: CircleDot
} as const;

const KIND_LABEL: Record<SelectionKind, string> = {
  product: "Product",
  module: "Module",
  feature: "Feature",
  requirement: "Requirement"
};

export function SearchResults({
  results,
  needle,
  selected,
  params
}: {
  results: Results;
  needle: string;
  selected: Selection | null;
  params: ListSearchParams | undefined;
}) {
  if (results.hits.length === 0) {
    return (
      <p className="cat-tree-note cat-tree-empty">
        Nothing matches “{needle}”. Search reads business IDs, names and requirement
        statements.
      </p>
    );
  }

  return (
    <ul className="cat-results" aria-label={`Records matching ${needle}`}>
      {results.hits.map((hit) => (
        <ResultRow
          key={`${hit.kind}:${hit.id}`}
          hit={hit}
          needle={needle}
          selected={selected}
          params={params}
        />
      ))}
      {/*
        The bound, stated. A list that silently stops at forty is a list that has told the
        viewer it found forty things — which is the one reading that is certainly wrong.
      */}
      {results.truncated ? (
        <li className="cat-result-more">
          Showing the {results.hits.length} closest matches. Narrow the search to see the rest.
        </li>
      ) : null}
    </ul>
  );
}

function ResultRow({
  hit,
  needle,
  selected,
  params
}: {
  hit: SearchHit;
  needle: string;
  selected: Selection | null;
  params: ListSearchParams | undefined;
}) {
  const Icon = ICON_BY_KIND[hit.kind];
  const here = isSelected(selected, hit.kind, hit.businessId);

  return (
    <li>
      <Link
        href={selectionHref(params, { kind: hit.kind, businessId: hit.businessId })}
        className="cat-result"
        aria-current={here ? "true" : undefined}
      >
        <span className="cat-result-head">
          <Icon size={14} aria-hidden style={{ flex: "none", opacity: 0.75 }} />
          <span className="cat-node-id">{hit.businessId}</span>
          {/* The level, in words. In a flat list the icon is the only thing distinguishing
              a module from a feature, and an icon is not a label. */}
          <span className="sr-only">{KIND_LABEL[hit.kind]}. </span>
          <span className="cat-result-label">
            <Marked text={hit.label} needle={needle} />
          </span>
        </span>

        {/*
          The ancestry, which is the whole reason a flat list is enough. Text rather than
          links: this row already IS a link, and nesting one inside it is invalid HTML —
          the breadcrumb here answers "where does this live", and the tree answers "take
          me there" once the search is cleared.
        */}
        {hit.trail.length > 0 ? (
          <span className="cat-result-trail">
            <span className="sr-only">In </span>
            {hit.trail.map((step, index) => (
              <span key={step.businessId}>
                {index > 0 ? <ChevronRight size={11} aria-hidden className="cat-crumb-sep" /> : null}
                <span className="cat-crumb">
                  <span className="cat-node-id">{step.businessId}</span> {step.name}
                </span>
              </span>
            ))}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * The label with the needle marked, when it is in there.
 *
 * A hit found by its business ID has a label the needle never appears in, so `highlight`
 * returning `null` is the normal case rather than a failure — the row renders plain and
 * the marked business ID above it already shows why it matched.
 */
function Marked({ text, needle }: { text: string; needle: string }) {
  const parts = highlight(text, needle);
  if (parts === null) return <>{text}</>;
  return (
    <>
      {parts.before}
      <mark>{parts.match}</mark>
      {parts.after}
    </>
  );
}
