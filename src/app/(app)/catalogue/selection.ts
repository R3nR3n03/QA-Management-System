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

/** Requirements are deliberately absent: they are rows in a feature's detail panel, not
 *  tree nodes. See `CATALOGUE-EXPLORER-REDESIGN.md` § 1 for why. */
export type SelectionKind = "product" | "module" | "feature";

export type Selection = { kind: SelectionKind; businessId: string };

export const SELECTION_PARAM = "sel";

/** One letter each, so the URL stays short enough to read at a glance. */
const KIND_BY_PREFIX: Record<string, SelectionKind> = {
  p: "product",
  m: "module",
  f: "feature"
};

const PREFIX_BY_KIND: Record<SelectionKind, string> = {
  product: "p",
  module: "m",
  feature: "f"
};

const PATTERN_BY_KIND: Record<SelectionKind, RegExp> = {
  product: BUSINESS_ID_PATTERNS.product,
  module: BUSINESS_ID_PATTERNS.module,
  feature: BUSINESS_ID_PATTERNS.feature
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

/** True when the two name the same record. Cheap enough to call once per tree row. */
export function isSelected(current: Selection | null, kind: SelectionKind, businessId: string): boolean {
  return current !== null && current.kind === kind && current.businessId === businessId;
}

/**
 * The href a tree row points at: this selection, every other parameter untouched.
 *
 * Passing `null` clears the selection and returns to the overview. Paging keys are
 * dropped, because they belong to the list of the record being left — keeping `?req=3`
 * while moving to a different feature lands the viewer past the end of a list they have
 * not seen.
 */
export function selectionHref(
  params: ListSearchParams | undefined,
  selection: Selection | null,
  pathname = "/catalogue"
): string {
  return hrefWith(pathname, params, {
    [SELECTION_PARAM]: selection === null ? null : selectionParam(selection),
    req: null
  });
}
