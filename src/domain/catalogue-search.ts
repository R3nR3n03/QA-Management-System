/**
 * Ranking and presenting catalogue search hits.
 *
 * Pure — no Prisma import — so the ordering rules and the highlight arithmetic are
 * testable without a database. `src/domain/catalogue.ts` runs the four bounded queries
 * and hands the rows here.
 *
 * ## Why search is a list and not a filtered tree
 *
 * It used to be a tree: every match dragged its ancestors on screen and every surviving
 * branch was force-expanded. That is a good answer for thirty records and the wrong one
 * for three thousand — a two-letter needle expanded hundreds of branches into a 300px
 * column, and producing it meant reading the whole Product, Module and Feature tables on
 * every commit and filtering them in JavaScript.
 *
 * A flat list carries the same ancestry in one line per hit (`PROD001 › MOD004 › FEAT012`),
 * which is the thing the tree shape was protecting, and it lets the database do the
 * matching under a `LIMIT`. See `docs/adr/0002-catalogue-search-is-a-flat-ranked-list.md`.
 */

export type SearchKind = "product" | "module" | "feature" | "requirement";

/** One step of a hit's ancestry. A requirement's trail is product, module, feature. */
export type SearchAncestor = {
  kind: "product" | "module" | "feature";
  businessId: string;
  name: string;
};

export type SearchHit = {
  kind: SearchKind;
  id: string;
  businessId: string;
  /** The record's name — for a requirement, its statement. */
  label: string;
  /** Ancestors, outermost first. Empty for a product. */
  trail: SearchAncestor[];
};

export type SearchResults = {
  hits: SearchHit[];
  /**
   * True when more records matched than the list is showing.
   *
   * The count is deliberately absent. Knowing the exact size of a set nobody is going to
   * read costs a `COUNT(*)` per level on an unindexable `ILIKE`, and "more than 40" is
   * the entire actionable content of the answer: narrow the needle.
   */
  truncated: boolean;
};

/** How many hits one search shows. A screenful; past that, the needle is the problem. */
export const DEFAULT_SEARCH_LIMIT = 40;

/**
 * Shallower first, when nothing else separates two hits.
 *
 * Searching "checkout" with a Checkout module and a "Checkout button" feature should
 * offer the module first: it is the thing that contains the other.
 */
const DEPTH: Record<SearchKind, number> = {
  product: 0,
  module: 1,
  feature: 2,
  requirement: 3
};

/**
 * How well a hit answers the needle. Lower is better.
 *
 * The order is the order a person means the query in. An exact business ID is not a
 * search, it is a lookup, so it wins outright. A prefix beats a match buried in the
 * middle of a sentence, because that is what typing the first few letters of something
 * means.
 */
export function scoreHit(hit: SearchHit, needle: string): number {
  const q = needle.trim().toLowerCase();
  if (q === "") return 5;

  const bid = hit.businessId.toLowerCase();
  const label = hit.label.toLowerCase();

  if (bid === q) return 0;
  if (bid.startsWith(q)) return 1;
  if (label.startsWith(q)) return 2;
  if (bid.includes(q)) return 3;
  if (label.includes(q)) return 4;
  // Reached only if the database matched a column this function does not read. Sorts
  // last rather than throwing: a hit the ranker does not understand is still a hit.
  return 5;
}

/**
 * The hits worth showing, best first.
 *
 * Sorting here rather than in SQL because the ranking spans four tables — no single
 * `ORDER BY` can interleave them, and four separately-ordered result sets concatenated
 * would put every product above every requirement whatever the needle was.
 */
export function rankHits(
  hits: readonly SearchHit[],
  needle: string,
  limit = DEFAULT_SEARCH_LIMIT
): SearchResults {
  const ordered = [...hits].sort((a, b) => {
    const byScore = scoreHit(a, needle) - scoreHit(b, needle);
    if (byScore !== 0) return byScore;
    const byDepth = DEPTH[a.kind] - DEPTH[b.kind];
    if (byDepth !== 0) return byDepth;
    return a.businessId.localeCompare(b.businessId);
  });

  return { hits: ordered.slice(0, limit), truncated: ordered.length > limit };
}

/** `text` split around the first occurrence of `needle`, for a `<mark>` in the result row. */
export type Highlight = { before: string; match: string; after: string };

/**
 * Where the needle sits inside a label, so the row can mark it.
 *
 * `null` when it is not there at all — which is normal and not an error: a hit found by
 * its business ID has a label the needle never appears in, and that row simply renders
 * plain. Case-insensitive to find it, but the slices come from the ORIGINAL string, so
 * the row shows the record's own capitalisation rather than the needle's.
 */
export function highlight(text: string, needle: string): Highlight | null {
  const q = needle.trim();
  if (q === "") return null;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return null;
  return {
    before: text.slice(0, at),
    match: text.slice(at, at + q.length),
    after: text.slice(at + q.length)
  };
}
