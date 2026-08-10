"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, Search } from "lucide-react";
import type { FeatureChoice } from "@/domain/catalogue";
import { searchFeaturesAction } from "./actions";

/**
 * Choose the feature a requirement hangs off, without navigating the tree to it.
 *
 * ## Why this is search rather than a dropdown
 *
 * The tree caps every branch at 50 children because one module can hold hundreds of features
 * (`docs/adr/0001-catalogue-tree-stops-at-feature.md`), so a `<select>` of all of them is the
 * unbounded read this screen deleted once already. It is also the wrong control for the job:
 * this exists for someone who does NOT know which feature they want, and a select can only be
 * scrolled, not asked. ADR-0001 already nominates search as the way to reach a record off the
 * tree — this is that, narrowed to one level.
 *
 * ## Every option carries its ancestry
 *
 * `FEAT007 Upload` does not identify a feature once two products both have an upload feature,
 * and a requirement filed under the wrong one is put in front of the wrong test cases. The
 * path is the disambiguator, so it is rendered on every row rather than on hover.
 *
 * ## Keyboard
 *
 * A listbox pattern: ↑/↓ move the active option, Enter takes it, Escape clears the box back to
 * browsing. `aria-activedescendant` moves the screen reader's attention without moving DOM
 * focus out of the input, which is what lets typing continue between arrow presses.
 */

/** Matches the toolbar's debounce: long enough that a word is one query. */
const DEBOUNCE_MS = 300;

export function FeaturePicker({
  name,
  label,
  formId,
  disabled = false,
  invalid = false,
  describedBy
}: {
  /** The hidden input's name — the field the server action reads (`featureId`). */
  name: string;
  label: string;
  formId: string;
  disabled?: boolean;
  /** True when the server rejected this field, so the control can wear the error. */
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const inputId = `${formId}-${name}`;
  const [needle, setNeedle] = useState("");
  const [choices, setChoices] = useState<FeatureChoice[]>([]);
  const [chosen, setChosen] = useState<FeatureChoice | null>(null);
  const [active, setActive] = useState(0);
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Which needle the newest request was for. A slower earlier query must not overwrite a
   * faster later one — server actions are not ordered, and the visible failure is the list
   * flicking back to results for a prefix the box no longer holds.
   */
  const latest = useRef("");

  const run = (value: string) => {
    latest.current = value;
    startTransition(async () => {
      const rows = await searchFeaturesAction(value);
      if (latest.current !== value) return;
      setChoices(rows);
      setActive(0);
    });
  };

  // The first page, before anything is typed: this control exists for someone who cannot yet
  // name what they are looking for, and an empty list gives them nothing to start from.
  useEffect(() => {
    run("");
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const schedule = (value: string) => {
    setNeedle(value);
    // Typing after a choice is made is the start of a different choice.
    if (chosen) setChosen(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(value), DEBOUNCE_MS);
  };

  /** Whether the listbox is on screen — the single source for the ARIA below and the render. */
  const listOpen = chosen === null && choices.length > 0;

  const take = (choice: FeatureChoice) => {
    setChosen(choice);
    setNeedle(`${choice.businessId} ${choice.name}`);
    // Move `active` onto what was actually taken. Without this a POINTER choice left the
    // keyboard's cursor wherever the last search put it (index 0), so a subsequent Enter
    // re-took `choices[0]` — silently swapping the chosen feature for the first search
    // result, plausibly under a different product. That is the exact mis-filing the `path`
    // on every row exists to prevent, arriving through the back door.
    const index = choices.findIndex((row) => row.id === choice.id);
    if (index >= 0) setActive(index);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && needle !== "") {
      event.preventDefault();
      setChosen(null);
      schedule("");
      return;
    }
    // Once a feature is chosen the listbox is gone, so the keys below have nothing to act on
    // and Enter belongs to the form again. Swallowing it here made the picker a dead end:
    // the only way to submit was to reach for the mouse.
    if (chosen !== null || choices.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % choices.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + choices.length) % choices.length);
    } else if (event.key === "Enter") {
      // The picker owns Enter while a list is open, or implicit submission would post the
      // form with no feature chosen from a keystroke that meant "take this one".
      event.preventDefault();
      take(choices[active]);
    }
  };

  return (
    <div className="field feature-picker" data-bad={invalid ? "" : undefined}>
      {/* The hidden input is what the form posts. Empty until something is chosen, so a
          submitted-but-unchosen form fails on `featureId` in the domain (404
          REFERENCE_NOT_FOUND) rather than silently filing the requirement somewhere. */}
      <input type="hidden" name={name} value={chosen?.id ?? ""} />
      <label htmlFor={inputId}>
        <span>{label}</span>
      </label>
      <div className="list-toolbar feature-picker-box" data-busy={isPending ? "" : undefined}>
        <Search size={14} aria-hidden />
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          /* Driven by whether the listbox is actually RENDERED, not by whether choices were
             fetched — the list is replaced by the confirmation line once something is chosen.
             Announcing an expanded combobox whose active descendant is not in the document
             leaves a screen reader describing a control that is no longer there. */
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-activedescendant={listOpen ? `${listId}-${active}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          placeholder="Search features by ID or name…"
          value={needle}
          disabled={disabled}
          autoFocus
          onChange={(event) => schedule(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      {chosen ? (
        <p className="feature-picker-chosen">
          <Check size={13} aria-hidden />
          <span className="bid">{chosen.businessId}</span> {chosen.name}
          <span className="muted feature-picker-path">{chosen.path}</span>
        </p>
      ) : (
        <ul className="feature-picker-list" id={listId} role="listbox" aria-label="Matching features">
          {choices.length === 0 ? (
            <li className="feature-picker-empty muted">
              {isPending ? "Searching…" : `No feature matches “${needle}”.`}
            </li>
          ) : (
            choices.map((choice, index) => (
              <li
                key={choice.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                data-active={index === active ? "" : undefined}
              >
                {/* A real button: this is a choice being made, and it has to be operable by
                    pointer as well as by the arrow keys above. `tabIndex={-1}` because the
                    input keeps the focus — 40 options would otherwise be 40 tab stops
                    between the box and the submit. */}
                <button type="button" tabIndex={-1} onClick={() => take(choice)}>
                  <span className="bid">{choice.businessId}</span> {choice.name}
                  <span className="muted feature-picker-path">{choice.path}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
