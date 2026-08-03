"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

/**
 * The one list-filter toolbar. Filtering is presentation: which rows exist is the
 * server's answer; what the viewer may do with one is the domain's. Escape clears.
 *
 * This is the CONTROLLED form, for filtering a list that is already entirely in memory
 * — `PlanForm`'s approved-case picker, where the candidate set is small, bounded, and
 * fetched for the form itself. Lists backed by a table use `UrlFilterToolbar` below.
 */
export function FilterToolbar({
  value,
  onChange,
  placeholder,
  label,
  busy = false
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  busy?: boolean;
}) {
  return (
    <div className="list-toolbar" data-busy={busy ? "" : undefined}>
      <Search size={14} aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
  );
}

/** Long enough that typing a word is one query, short enough to feel immediate. */
const DEBOUNCE_MS = 300;

/**
 * The filter for a list the server pages: the needle lives in the query string, so the
 * matching rows are SELECTed rather than filtered out of a full table already shipped
 * to the browser.
 *
 * Three things this has to get right:
 *
 * - **Debounce.** Every keystroke would otherwise be a server round trip. The timer is
 *   cleared on unmount, so a pending keystroke cannot navigate a torn-down tree.
 * - **Reset the page.** Filtering while on page 4 must return to page 1, or the viewer
 *   lands on an empty page of a now-shorter list. The page key is deleted on commit.
 * - **Follow the URL back.** Browser Back changes the query string underneath us; the
 *   input re-syncs from it (the "adjust state during render" pattern this codebase uses
 *   elsewhere) instead of holding a stale needle.
 *
 * `router.replace`, not `push`: typing a filter should not bury the previous screen
 * under one history entry per keystroke.
 */
export function UrlFilterToolbar({
  placeholder,
  label,
  paramKey = "q",
  pageKey = "page"
}: {
  placeholder: string;
  label: string;
  paramKey?: string;
  pageKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const urlValue = searchParams.get(paramKey) ?? "";
  const [value, setValue] = useState(urlValue);
  const [syncedFrom, setSyncedFrom] = useState(urlValue);
  if (urlValue !== syncedFrom) {
    setSyncedFrom(urlValue);
    setValue(urlValue);
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const commit = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = next.trim();
    if (trimmed === "") params.delete(paramKey);
    else params.set(paramKey, trimmed);
    params.delete(pageKey);
    const query = params.toString();
    startTransition(() => {
      router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
    });
  };

  const schedule = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), DEBOUNCE_MS);
  };

  /** Escape and Enter skip the debounce — both are the viewer saying "now". */
  const flush = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setValue(next);
    commit(next);
  };

  return (
    <div className="list-toolbar" data-busy={isPending ? "" : undefined}>
      <Search size={14} aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => schedule(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") flush("");
          if (e.key === "Enter") {
            e.preventDefault();
            flush(value);
          }
        }}
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
  );
}
