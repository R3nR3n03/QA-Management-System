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
  busy = false,
  disabled = false
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  busy?: boolean;
  /** Held while the surrounding form is submitting, like every other control in it. */
  disabled?: boolean;
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
          // This filter sits INSIDE PlanForm's <form>, so Enter would otherwise trigger
          // implicit submission and fire the real submit button — creating the execution
          // and redirecting away mid-filter, from a keystroke meant to narrow a list.
          // Reachable the moment anything is selected, which is when the submit button
          // stops being disabled. `UrlFilterToolbar` below already guards this.
          if (e.key === "Enter") e.preventDefault();
        }}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
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
  /**
   * The last needle THIS input put in the URL, so its own echo can be told apart from
   * a genuinely external change. State, not a ref: it is read while rendering, and a
   * ref read during render is not safe under concurrent rendering.
   *
   * Without that distinction the re-sync deleted characters as they were typed. A
   * commit writes the TRIMMED needle and `router.replace` runs in a transition, so the
   * new `searchParams` only arrives after a server round trip — by which time the
   * typing has moved on. The next render then saw a URL that differed from
   * `syncedFrom` and dutifully overwrote the input with the older, shorter value.
   *
   * Type "foo", pause past the debounce, keep typing " bar": the commit for "foo"
   * lands mid-word and the input snaps back to "foo". The slower the query, the wider
   * the window — worst exactly where the debounce was supposed to help most.
   */
  const [committed, setCommitted] = useState(urlValue);
  if (urlValue !== syncedFrom) {
    setSyncedFrom(urlValue);
    // Follow the URL only when something other than this input moved it — Back,
    // Forward, or a link. Our own echo is ignored: the input is already ahead of it.
    if (urlValue !== committed) setValue(urlValue);
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
    setCommitted(trimmed);
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

/**
 * A single-choice list filter that lives in the query string, like the needle above.
 *
 * A `<select>` rather than the chip row the lifecycle states use: those are a closed set
 * of three or four, while products are catalogue records with no ceiling — a chip per
 * product would wrap into a wall the moment a real catalogue arrives, and it would grow
 * without anyone deciding it should.
 *
 * `router.replace` and no debounce: unlike typing, picking an option is one deliberate
 * act, so it commits immediately and does not deserve a history entry of its own.
 */
export function UrlSelectFilter({
  options,
  label,
  allLabel,
  paramKey,
  pageKey = "page"
}: {
  options: Array<{ value: string; label: string }>;
  label: string;
  allLabel: string;
  paramKey: string;
  pageKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const value = searchParams.get(paramKey) ?? "";

  const commit = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "") params.delete(paramKey);
    else params.set(paramKey, next);
    // Narrowing while on page 4 would land on nothing: the filtered list is shorter.
    params.delete(pageKey);
    const query = params.toString();
    startTransition(() => {
      router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
    });
  };

  return (
    <select
      className="select-filter"
      aria-label={label}
      value={value}
      data-busy={isPending ? "" : undefined}
      onChange={(event) => commit(event.target.value)}
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
