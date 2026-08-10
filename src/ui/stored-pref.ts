"use client";

import { useSyncExternalStore } from "react";

/**
 * Browser-local UI preferences: the settings that belong to a person's browser rather than
 * to the record.
 *
 * NOT a place for anything the domain owns. A preference here is invisible to the server,
 * unshared between devices, and lost when someone clears their storage — which is right for
 * "I collapsed the nav" and wrong for anything a policy, an audit trail or another user
 * could ever need to see.
 *
 * Extracted from `sidebar.tsx`, which had the only copy, when the My work tip card needed
 * the same thing. The hydration-safe read below is subtle enough that a second hand-rolled
 * version would be a second chance to get it wrong.
 */

/** One event for every preference, so a write in one component repaints the others. */
const PREF_EVENT = "qams-pref-change";

/**
 * Hoisted, not inline: `useSyncExternalStore` re-subscribes whenever the `subscribe`
 * identity changes, and an arrow defined in a component body is a new function every
 * render. The sidebar re-renders on every keystroke in its search and on every route
 * change, so an inline version tore down and re-attached four window listeners each time.
 * It closes over nothing, so there is no reason for it to live in a body.
 */
function subscribeToPrefs(onChange: () => void): () => void {
  window.addEventListener(PREF_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PREF_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * A localStorage-backed preference as React state, via `useSyncExternalStore` so the server
 * snapshot (the fallback) and the client snapshot resolve without a hydration mismatch —
 * someone who chose a non-default sees one repaint after hydration, never an error. Writes
 * notify through one window event so every subscriber re-reads, including other tabs.
 */
export function useStoredPref(
  key: string,
  fallback: string
): [string, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribeToPrefs,
    // Storage can throw outright — Safari private browsing, or a browser configured to
    // block it. This runs during render, so an unguarded read would take the whole client
    // tree down over a preference. A preference is never worth that: fall back.
    () => {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback
  );
  const set = (next: string | null) => {
    try {
      if (next === null) localStorage.removeItem(key);
      else localStorage.setItem(key, next);
    } catch {
      // Not persisted. The event below still repaints this session correctly.
    }
    window.dispatchEvent(new Event(PREF_EVENT));
  };
  return [value, set];
}
