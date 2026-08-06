"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * Re-fetch the current screen's server data without a full page load.
 *
 * A work queue is a shared surface: a colleague can plan a run against you, or finalize
 * one you are looking at, while the tab sits open. `router.refresh()` re-runs the server
 * component and swaps in the new rows, keeping scroll position and the query string —
 * which browser reload does not, and which polling would buy at the cost of a query per
 * viewer per interval for a screen that is mostly idle.
 *
 * The transition's pending flag drives the spin, so the control says the fetch is in
 * flight rather than looking inert on a slow query. It stays a real `<button>`: this
 * performs an action rather than going somewhere, so it must not be a link.
 */
export function RefreshButton({ label }: { label: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => startTransition(() => router.refresh())}
      aria-label={label}
      data-busy={isPending ? "" : undefined}
    >
      <RefreshCw size={15} aria-hidden />
      {/* Announced instead of the spin, which a screen reader cannot see and a viewer
          with reduced motion will not get. */}
      <span className="sr-only" role="status">
        {isPending ? "Refreshing…" : ""}
      </span>
    </button>
  );
}
