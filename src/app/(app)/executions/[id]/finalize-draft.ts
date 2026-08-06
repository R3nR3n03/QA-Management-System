"use client";

import { useSyncExternalStore } from "react";

/**
 * Where a half-finished run is held between page loads, and who may read it.
 *
 * `sessionStorage`, not the server: "there is no partial finalize"
 * (`docs/business-rules-and-validation.md:28`) means a per-case result CANNOT be written
 * until the whole run is submitted, so there is nowhere on the server for a draft to
 * live. Holding it only in `useState` meant a refresh — or a trip to another module and
 * back — silently discarded every result already recorded, which on a twelve-case run is
 * an afternoon's work.
 *
 * Tab-scoped on purpose. It survives the two things that were losing work (a reload, and
 * navigating away and back) and goes away with the tab, so a shared browser does not
 * retain someone else's un-submitted evidence indefinitely. `localStorage` would outlive
 * the tab at that cost; if a run needs to survive a browser restart, that is a
 * partial-finalize question for the docs, not a storage choice.
 *
 * This lives apart from `FinalizeForm` because the form is no longer the only reader: the
 * result summary above it counts the same held results, and two components reading one
 * draft have to read one store. A second copy of this file would be a second
 * `draftMemory`, which is a store that disagrees with itself.
 */
export const DRAFT_PREFIX = "qams.finalize.";

/** One case's result, held client-side until the whole run is finalized. */
export type CaseResult = {
  result: string;
  actualResult: string;
  blockReason: string;
  defectId: string;
  defectSummary: string;
  defectPriority: string;
  defectSeverity: string;
};

export const EMPTY_RESULT: CaseResult = {
  result: "",
  actualResult: "",
  blockReason: "",
  defectId: "",
  defectSummary: "",
  defectPriority: "",
  defectSeverity: ""
};

/** The three outcomes, in the order they are offered. */
export const OUTCOMES = ["PASS", "FAIL", "BLOCKED"] as const;

export type StoredDraft = { version: number; recorded: Record<string, CaseResult> };

/**
 * One stored entry, coerced back into a `CaseResult` — or `null` if it is not one.
 *
 * Storage is editable by hand and outlives deploys, so nothing read out of it is trusted:
 * every field is forced to a string (a number reaching a controlled input would make it
 * uncontrolled mid-edit), and an entry with no valid outcome is rejected outright. That
 * last check guards the rule the whole form exists to keep — a shape-only entry would
 * count toward "recorded" and could enable Finalize on results nobody chose.
 */
function normalizeResult(raw: unknown): CaseResult | null {
  if (raw === null || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const text = (key: keyof CaseResult) => (typeof row[key] === "string" ? (row[key] as string) : "");
  const result = text("result");
  if (!OUTCOMES.some((outcome) => outcome === result)) return null;
  return {
    result,
    actualResult: text("actualResult"),
    blockReason: text("blockReason"),
    defectId: text("defectId"),
    defectSummary: text("defectSummary"),
    defectPriority: text("defectPriority"),
    defectSeverity: text("defectSeverity")
  };
}

/**
 * The draft as an external store, read through `useSyncExternalStore`.
 *
 * The draft is deliberately NOT mirrored into `useState`. Two copies would need an effect
 * to reconcile them on mount, and a `setState` in an effect body is a cascading render
 * the moment it lands — the very pattern React's own guidance (and this project's lint)
 * rejects. `useSyncExternalStore` is the sanctioned way to read state React does not own:
 * `getServerSnapshot` returns "no draft" so the server-rendered HTML is stable, and React
 * re-reads once after hydration.
 *
 * The snapshot is the raw STRING, not the parsed object. A parse per call would hand
 * React a fresh object identity every time and spin forever; a string compares by value.
 *
 * `draftMemory` is the authoritative copy for the page session, with `sessionStorage` as
 * the layer that survives a reload. Without it, a browser that refuses storage (private
 * mode, a locked-down profile) could never record a result at all — the write would throw
 * and the read would keep answering "nothing recorded".
 */
const draftMemory = new Map<string, string>();
const draftListeners = new Set<() => void>();

function subscribeToDraft(onStoreChange: () => void) {
  draftListeners.add(onStoreChange);
  return () => {
    draftListeners.delete(onStoreChange);
  };
}

/** The server has no draft, and neither does the first client render, or they disagree. */
const noDraft = () => null;

function readDraftRaw(key: string | null): string | null {
  if (key === null) return null;
  const held = draftMemory.get(key);
  if (held !== undefined) return held;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeDraft(key: string, draft: StoredDraft | null) {
  const raw = draft === null ? null : JSON.stringify(draft);
  if (raw === null) draftMemory.delete(key);
  else draftMemory.set(key, raw);
  try {
    if (raw === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, raw);
  } catch {
    // Storage refused or is full. The in-memory copy above still holds the draft for this
    // page session, so recording keeps working — it just will not survive a reload.
  }
  for (const listener of draftListeners) listener();
}

/**
 * The raw stored draft for one run, or `null` where there is nothing to read — a `null`
 * key being the caller saying "this screen has no draft", which a read-only run does not.
 */
export function useDraftRaw(key: string | null): string | null {
  return useSyncExternalStore(subscribeToDraft, () => readDraftRaw(key), noDraft);
}

/**
 * The stored draft, as the results of the cases this run actually covers.
 *
 * Nothing read here is trusted: storage is editable by hand and outlives deploys. A
 * version mismatch means the run moved under the draft — started, reassigned, or
 * finalized in another tab — so the draft no longer describes what is on screen. Entries
 * are keyed off the covered cases rather than off the stored keys, so a case that has
 * since left the run cannot come back through storage.
 */
export function draftResults(
  raw: string | null,
  version: number,
  testCaseIds: string[]
): Record<string, CaseResult> {
  if (raw === null) return {};
  let stored: Partial<StoredDraft> | null = null;
  try {
    stored = JSON.parse(raw) as Partial<StoredDraft>;
  } catch {
    return {};
  }
  if (!stored || stored.version !== version || !stored.recorded) return {};

  const results: Record<string, CaseResult> = {};
  for (const testCaseId of testCaseIds) {
    const entry = normalizeResult(stored.recorded[testCaseId]);
    if (entry) results[testCaseId] = entry;
  }
  return results;
}
