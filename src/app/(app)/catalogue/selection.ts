/**
 * What the catalogue explorer currently has selected, carried in the query string.
 *
 * `?sel=m:MOD004` rather than React state, for four reasons that all matter here:
 *
 * 1. **Server actions land back on the URL they were submitted from.** Every action in
 *    `actions.ts` ends in `refreshScreen`, which returns to the submitting URL rather than
 *    a bare `/catalogue` (see `src/ui/action.ts`, and the reason recorded in `actions.ts`).
 *    Held in component state, the selection would be lost on every add and every edit —
 *    you would add a feature to a module and be returned to no selection at all.
 * 2. It is linkable: "look at MOD004" becomes a URL.
 * 3. Browser Back walks the selection history for nothing.
 * 4. A server component can read it. `useState` is invisible to the fetch.
 *
 * Business IDs, not UUIDs: they are `@unique` on all four models, they are the identifier
 * a person already uses, and they survive being pasted into a chat window legibly.
 *
 * Pure string handling — no React, no `next/*` — so it is unit-testable directly, the
 * same shape as `src/ui/list-params.ts` and `src/ui/navigation.ts`.
 */

import { BUSINESS_ID_PATTERNS } from "@/lib/business-ids";
import { hrefWith, readParam, type ListSearchParams } from "@/ui/list-params";

/** All four levels of the hierarchy are selectable. */
export type SelectionKind = "product" | "module" | "feature" | "requirement";

export type Selection = { kind: SelectionKind; businessId: string };

export const SELECTION_PARAM = "sel";

/** One letter each, so the URL stays short enough to read at a glance. `r`, not `q` — the
 *  needle already owns `q`, and two meanings for one letter in one URL is a trap. */
const KIND_BY_PREFIX: Record<string, SelectionKind> = {
  p: "product",
  m: "module",
  f: "feature",
  r: "requirement"
};

const PREFIX_BY_KIND: Record<SelectionKind, string> = {
  product: "p",
  module: "m",
  feature: "f",
  requirement: "r"
};

const PATTERN_BY_KIND: Record<SelectionKind, RegExp> = {
  product: BUSINESS_ID_PATTERNS.product,
  module: BUSINESS_ID_PATTERNS.module,
  feature: BUSINESS_ID_PATTERNS.feature,
  requirement: BUSINESS_ID_PATTERNS.requirement
};

/**
 * `"m:MOD004"` → `{ kind: "module", businessId: "MOD004" }`, or `null` for anything else.
 *
 * The business ID is validated against the same pattern the domain enforces on write
 * (`src/lib/business-ids.ts`), so a hand-edited `?sel=m:whatever` reads as no selection
 * and the screen shows its overview — rather than reaching the database to ask for a row
 * that could never exist. Prisma parameterises the query either way; this is about giving
 * a nonsense URL a sensible answer instead of an empty detail panel.
 *
 * Uppercased before matching, so a URL typed in lower case still works.
 */
export function parseSelection(raw: string | undefined): Selection | null {
  if (!raw) return null;
  const separator = raw.indexOf(":");
  if (separator < 1) return null;

  const kind = KIND_BY_PREFIX[raw.slice(0, separator).toLowerCase()];
  if (!kind) return null;

  const businessId = raw.slice(separator + 1).trim().toUpperCase();
  return PATTERN_BY_KIND[kind].test(businessId) ? { kind, businessId } : null;
}

/** The selection in the page's `searchParams`, or `null`. */
export function readSelection(params: ListSearchParams | undefined): Selection | null {
  return parseSelection(readParam(params, SELECTION_PARAM));
}

/** `{ kind: "module", businessId: "MOD004" }` → `"m:MOD004"`. */
export function selectionParam(selection: Selection): string {
  return `${PREFIX_BY_KIND[selection.kind]}:${selection.businessId}`;
}

/**
 * Which branches are expanded, carried in the query string as `?open=PROD001.MOD002`.
 *
 * **Separate from `sel` on purpose.** Expansion used to be derived from the selection: a
 * branch was open because the selected record was inside it, so the row link doubled as
 * the expand/collapse toggle. Two things a viewer means separately — "show me this record"
 * and "let me see what is inside this one" — were one action, which made the tree behave
 * as if it would not open at all:
 *
 * - Clicking an already-selected, already-open node navigated to its PARENT to close it,
 *   and a product has no parent, so a second click on a product threw the selection away
 *   and returned to a bare `/catalogue`. Clicking a product twice — the ordinary way anyone
 *   opens a tree — opened it and then shut it.
 * - Only one branch could ever be open, because one selection has one ancestor path.
 *   Opening a second product silently collapsed the first.
 *
 * A set of business IDs fixes both: any number of branches stay open, and opening one is
 * no longer a selection. The selected record's own ancestors are still forced open by the
 * page, so a link to a deep node reveals it without `open` having to name every step.
 */
export const OPEN_PARAM = "open";

/** `.` rather than `,`: `URLSearchParams` leaves it unescaped, so the URL stays readable. */
const OPEN_SEPARATOR = ".";

/**
 * A ceiling on how many branches one URL may open, because each open branch is a row in
 * the `IN (…)` of the tree's fetch. Far above what anyone opens by hand; it exists so a
 * pasted URL cannot turn one page load into an unbounded query.
 */
export const MAX_OPEN_NODES = 64;

/**
 * The page key for whatever child list the detail panel is showing.
 *
 * ONE key for all three levels, because the panel shows exactly one child list at a time —
 * a product's modules, a module's features, or a feature's requirements. It was `req`,
 * from when requirements were the only paged list on the screen; every child list is paged
 * now (`getProductDetail`, `getModuleDetail`), and three keys for one control would be
 * three ways to strand a viewer on page 3 of a list they had left.
 */
export const CHILD_PAGE_PARAM = "c";

/** Levels that can be expanded in the tree. Not `feature` — the tree stops there. */
const EXPANDABLE_KINDS = ["product", "module"] as const;

/**
 * Which level a business ID belongs to, from its own format — `"MOD004"` → `"module"`.
 *
 * The open set carries bare IDs rather than `m:MOD004` pairs: the four formats are already
 * disjoint, so the prefix IS the kind, and a shorter URL is one a person can still read.
 */
export function kindOfBusinessId(businessId: string): SelectionKind | null {
  for (const kind of ["product", "module", "feature", "requirement"] as const) {
    if (PATTERN_BY_KIND[kind].test(businessId)) return kind;
  }
  return null;
}

/** True for a level the tree can expand — Product and Module, and nothing below them. */
function isExpandable(kind: SelectionKind | null): boolean {
  return kind !== null && (EXPANDABLE_KINDS as readonly SelectionKind[]).includes(kind);
}

/**
 * `"PROD001.MOD004"` → `{"PROD001", "MOD004"}`.
 *
 * Anything unrecognised is dropped rather than throwing — same contract as
 * `parseSelection`, and for the same reason: a hand-edited URL should degrade to a sensible
 * tree, not a crashed screen. Features and requirements are dropped too: the tree stops at
 * Feature, so neither is a branch any query can open.
 */
export function parseOpenSet(raw: string | undefined): Set<string> {
  const open = new Set<string>();
  if (!raw) return open;

  for (const part of raw.split(OPEN_SEPARATOR)) {
    const businessId = part.trim().toUpperCase();
    if (!isExpandable(kindOfBusinessId(businessId))) continue;
    open.add(businessId);
    if (open.size >= MAX_OPEN_NODES) break;
  }
  return open;
}

/** The open set in the page's `searchParams`. Empty when nothing is expanded. */
export function readOpenSet(params: ListSearchParams | undefined): Set<string> {
  return parseOpenSet(readParam(params, OPEN_PARAM));
}

/** The set back as a parameter value, or `null` when empty so the key leaves the URL. */
export function openParamValue(open: ReadonlySet<string>): string | null {
  return open.size === 0 ? null : [...open].join(OPEN_SEPARATOR);
}

/** True when `businessId`'s branch is expanded. */
export function isOpen(open: ReadonlySet<string>, businessId: string): boolean {
  return open.has(businessId);
}

/**
 * The href the chevron points at: this branch flipped, and **nothing else touched**.
 *
 * Not `selectionHref`: expanding a branch must not move the selection, must not clear the
 * detail panel, and must not reset `?req=` — the viewer is looking around, not choosing.
 */
export function toggleOpenHref(
  params: ListSearchParams | undefined,
  businessId: string,
  pathname = "/catalogue"
): string {
  const open = readOpenSet(params);
  if (!open.delete(businessId)) open.add(businessId);
  return hrefWith(pathname, params, { [OPEN_PARAM]: openParamValue(open) });
}

/**
 * Every branch shut, and nothing else touched.
 *
 * The counterpart to opening branches one at a time. Twelve open branches take twelve
 * clicks to undo and each one is a round trip; getting back to a tree you can see the
 * shape of should be one action. The selection survives — collapsing is looking around,
 * exactly as expanding is, and the selected record's own ancestors are re-opened by the
 * page anyway so the panel and the tree cannot disagree about where you are.
 */
export function collapseAllHref(
  params: ListSearchParams | undefined,
  pathname = "/catalogue"
): string {
  return hrefWith(pathname, params, { [OPEN_PARAM]: null });
}

/** True when the two name the same record. Cheap enough to call once per tree row. */
export function isSelected(current: Selection | null, kind: SelectionKind, businessId: string): boolean {
  return current !== null && current.kind === kind && current.businessId === businessId;
}

/**
 * The href a tree row points at: this selection, every other parameter untouched.
 *
 * Passing `null` clears the selection and returns to the overview. The child page is
 * dropped, because it belongs to the list of the record being left — keeping `?c=3` while
 * moving to a different record lands the viewer past the end of a list they have not seen.
 *
 * `open` is deliberately NOT dropped: which branches are expanded is the shape of the tree
 * the viewer has built up, and choosing a record must not collapse it. That is the whole
 * point of keeping the two parameters apart — see `OPEN_PARAM`.
 */
export function selectionHref(
  params: ListSearchParams | undefined,
  selection: Selection | null,
  pathname = "/catalogue"
): string {
  return hrefWith(pathname, params, {
    [SELECTION_PARAM]: selection === null ? null : selectionParam(selection),
    [CHILD_PAGE_PARAM]: null
  });
}
