"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PAGE_SIZE } from "./paging";

/**
 * Rows per page, as one dropdown.
 *
 * ## Why this replaced a row of links
 *
 * It used to be one button per size — `Rows [25][50][100]` — with the current one raised.
 * Three controls for one setting, each a separate tab stop, and the row grew with every
 * option anyone might add. A select says the current value in the closed state and costs
 * one stop, which is what a single-choice setting should cost.
 *
 * ## What that trades away
 *
 * The links worked with no JavaScript; this does not. That is the same trade
 * `UrlSelectFilter` already makes for the product and feature filters sitting a few
 * centimetres above it, and it is confined to the size control — `Pager`'s page numbers and
 * Prev/Next are still real `<a href>`s, so navigating a list never depends on hydration.
 *
 * `router.replace`, not `push`: changing the page size is an adjustment to the current view,
 * not a place to come Back to.
 */
export function PageSizeSelect({
  options,
  pageSize,
  sizeKey = "size",
  pageKey = "page",
  label
}: {
  options: readonly number[];
  /** The size in effect, resolved by the server from the URL. */
  pageSize: number;
  sizeKey?: string;
  pageKey?: string;
  /** Names the list this governs — screens can show more than one. */
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const commit = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    // The default size clears the key rather than writing `size=50` into every URL.
    if (Number(next) === PAGE_SIZE) params.delete(sizeKey);
    else params.set(sizeKey, next);
    // Page 7 of 50-row pages is not page 7 of 100-row pages: resizing returns to the start
    // rather than stranding the reader at an offset that no longer lines up.
    params.delete(pageKey);
    const query = params.toString();
    startTransition(() => {
      router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
    });
  };

  return (
    <span className="page-size">
      {/* The word sits outside the control and the control carries the full name for
          assistive tech, so "Rows" is not the only thing announced. */}
      <span className="muted" aria-hidden>
        Rows
      </span>
      <select
        className="select-filter select-sm"
        aria-label={`Rows per page of the ${label}`}
        value={String(pageSize)}
        data-busy={isPending ? "" : undefined}
        onChange={(event) => commit(event.target.value)}
      >
        {options.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </span>
  );
}
