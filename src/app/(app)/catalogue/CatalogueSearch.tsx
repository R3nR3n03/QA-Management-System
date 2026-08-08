"use client";

import { useEffect } from "react";
import { UrlFilterToolbar } from "@/ui/toolbar";
import { CHILD_PAGE_PARAM } from "./selection";

/**
 * The catalogue's needle, and what it found.
 *
 * The input is the shared `UrlFilterToolbar` rather than a new one: the debounce, the
 * Escape-to-clear, the busy state and — most importantly — the re-sync that follows the
 * browser's Back button without eating keystrokes are all subtle and already correct
 * there (`src/ui/toolbar.tsx`). This component adds the two things that are specific to
 * this screen: the shortcut, and the announcement.
 *
 * `pageKey` matters. The toolbar drops one page key on every commit so a narrowed list
 * cannot strand the viewer past its end, and `c` — the detail panel's child list — is the
 * only page key on this screen. Without it: select a feature, page to requirement page 3,
 * type in the search — and land on an empty page 3, which is precisely the failure
 * `src/ui/list-empty.tsx` was written to explain.
 *
 * Searching does NOT clear the selection. The results are how you navigate; the panel is
 * what you are reading, and a typo you immediately correct should not close the record you
 * had open.
 */

/** Document-wide, so the shortcut can find the input. One search box on this screen. */
const INPUT_ID = "catalogue-search";

export function CatalogueSearch({
  matchCount,
  truncated = false,
  needle
}: {
  /** `null` when nothing was searched — which is not the same as `0`. */
  matchCount: number | null;
  /** True when more records matched than the list is showing. */
  truncated?: boolean;
  needle: string;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/") return;
      // A modified slash belongs to the browser (⌘/ , ctrl+/), not to us.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Typing a slash into any field is typing a slash, including into this very box.
      if (isTyping(event.target)) return;
      // A modal owns the keyboard while it is open — Modal traps focus and handles Escape,
      // and stealing focus out to the page behind it would break that trap.
      if (document.querySelector("dialog[open]")) return;

      const input = document.getElementById(INPUT_ID);
      if (!(input instanceof HTMLInputElement)) return;

      // Without this the slash lands in the box it just focused.
      event.preventDefault();
      input.focus();
      input.select();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <UrlFilterToolbar
        inputId={INPUT_ID}
        placeholder="Search catalogue…"
        label="Search the catalogue"
        paramKey="q"
        pageKey={CHILD_PAGE_PARAM}
      />
      {/*
        Always in the DOM, empty when idle. A live region that is added to the page at the
        same moment its text appears is frequently not announced at all — the region has to
        already exist for the change to be a change. `:empty` takes its padding back.
      */}
      <p className="cat-tree-note" role="status" aria-live="polite">
        {announce(matchCount, truncated, needle)}
      </p>
    </>
  );
}

/**
 * What the list is showing, in words.
 *
 * Counts the rows on screen, never a total the viewer cannot see. When the search hit its
 * bound the sentence says so rather than reporting the cap as if it were the answer —
 * "40 records match" for a needle that matched four hundred is the one reading that is
 * certainly wrong.
 */
function announce(matchCount: number | null, truncated: boolean, needle: string): string {
  if (matchCount === null || needle === "") return "";
  if (matchCount === 0) return `Nothing matches “${needle}”.`;
  if (truncated) return `Showing the closest ${matchCount} of more matches for “${needle}”.`;
  return `${matchCount} record${matchCount === 1 ? "" : "s"} match${matchCount === 1 ? "es" : ""} “${needle}”.`;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}
