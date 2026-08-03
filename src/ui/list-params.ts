/**
 * Reading and rewriting the query string that drives a list screen.
 *
 * Page and filter live in the URL, not in component state. That is what lets the rows
 * be fetched already-paged on the server: a server component can read `searchParams`,
 * a `useState` in a client component is invisible to it. It also makes a filtered page
 * linkable, survivable across a refresh, and navigable with the browser's Back button —
 * none of which the previous client-side slicing offered.
 *
 * Pure string handling, no React and no Next imports, so it is unit-testable directly.
 */

/** The shape Next hands a page component for `searchParams`. */
export type ListSearchParams = Record<string, string | string[] | undefined>;

/**
 * One value for `key`, trimmed. A repeated parameter (`?q=a&q=b`) takes the first —
 * arbitrary, but defined, and a list filter has no meaning for the second.
 */
export function readParam(params: ListSearchParams | undefined, key: string): string {
  const raw = params?.[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A 1-based page number from the query string. Anything unparseable, zero, negative or
 * fractional reads as page 1 rather than throwing — a hand-edited URL should show the
 * first page, not an error.
 */
export function readPage(params: ListSearchParams | undefined, key = "page"): number {
  const raw = readParam(params, key);
  if (raw === "") return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.floor(parsed));
}

/**
 * `pathname` with `changes` applied over the current parameters. A `null` or `""` value
 * removes its key, so a cleared filter leaves a clean URL instead of `?q=`.
 *
 * Preserving the untouched parameters is the point: the catalogue screen pages four
 * independent lists, and turning one page must not reset the other three.
 */
export function hrefWith(
  pathname: string,
  params: ListSearchParams | undefined,
  changes: Record<string, string | number | null>
): string {
  const next = new URLSearchParams();
  for (const [key, raw] of Object.entries(params ?? {})) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && value !== "") next.set(key, value);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, String(value));
  }
  const query = next.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}
