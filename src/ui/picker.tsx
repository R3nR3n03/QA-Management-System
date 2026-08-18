"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Search } from "lucide-react";

/**
 * The one record-backed picker: a native `<select>` while the list is short, a searchable
 * combobox once it is long.
 *
 * Generalized from `FeaturePicker`, which was this control built for a single field. The
 * mechanics here — `aria-activedescendant`, the debounce, the stale-response guard, Enter
 * ownership, the hidden input — are its, and its tests are this file's tests. What is new is
 * that any record-backed field can have them (ADR-0011).
 *
 * ## The threshold decides the control, not just the search box
 *
 * A needle earns its place when the list would scroll. Below `NEEDLE_THRESHOLD` this renders
 * a real `<select>`, because under ten options the platform's control beats anything built
 * here: the OS picker on a touch device, `<optgroup>`, type-ahead, and an accessibility
 * implementation nobody has to maintain. Above it, a combobox, because a select can only be
 * scrolled, not asked (`docs/adr/0001-catalogue-tree-stops-at-feature.md`).
 *
 * So enum fields — priority, severity, role, status — opt out by arithmetic rather than by
 * anyone deciding. A search box over four options costs a keystroke and buys nothing.
 *
 * **This means one component with two DOM shapes.** A test or a stylesheet that assumes
 * `role="combobox"` passes with eleven options and breaks with nine. That is the price of the
 * rule, it is asserted on both sides of the boundary in `picker.test.tsx`, and it is the first
 * thing to check when a picker behaves unlike the one next to it.
 *
 * ## Two data sources, one behaviour
 *
 * `options` for a list already in the browser, `search` for one that is not — exactly one of
 * them. With `search` the count is unknowable up front, so that path is always the combobox.
 * A caller switching from one to the other changes nothing else.
 *
 * ## The needle is not the answer
 *
 * `value` changes only when an option is taken. Clearing the box returns the reader to
 * browsing and nothing else; the sole route back to `""` is the `blank` row, which exists only
 * where the caller says blank means something ("No defect", "Follow the organization"). A
 * required field therefore cannot be emptied once filled — and an accidental select-all-delete
 * cannot silently unlink a defect.
 *
 * ## What this does not do
 *
 * No multi-select: `case-picker.tsx` owns choosing many, with groups, indeterminate parents
 * and a render cap, and a `multiple` prop here would be two unrelated controls wearing one
 * name. No knowledge of chained fields either — `NewCaseForm` resets its children when a
 * parent moves, because the relationship is the caller's and the two chains in this app do not
 * even have the same shape.
 *
 * No validation, and above the threshold no native submit blocking: `required` on a hidden
 * input is ignored by every browser, so an unfilled picker posts and the domain rejects it
 * with a field-scoped error the form's `FormNotice` already shows. `aria-required` keeps the
 * announcement. The domain refusal was always the real gate (`docs/architecture.md`).
 */

/**
 * Where a list stops fitting and starts scrolling. One constant, deliberately not a prop: a
 * threshold each caller can set is a threshold that drifts, and then two pickers on one screen
 * disagree about when search is offered.
 */
export const NEEDLE_THRESHOLD = 10;

/** Matches the toolbar's debounce: long enough that a word is one query. */
const DEBOUNCE_MS = 300;

export type PickerOption = {
  value: string;
  label: string;
  /**
   * The human-facing business ID, where the record has one. Split from the label so it keeps
   * the `.bid` treatment it wears in every list and header in this app; a native `<option>`
   * cannot style its own insides, so there it is joined back on as `PROD001 · Storefront`,
   * which is the copy those selects already shipped.
   */
  code?: string;
  /**
   * The disambiguator, on its own line under the label. `FEAT007 Upload` does not identify a
   * feature once two products both have an upload feature, and a requirement filed under the
   * wrong one is put in front of the wrong test cases.
   */
  hint?: string;
};

/** A labelled run of options — time zones by region, and nothing else so far. */
export type PickerGroup = { label: string; options: readonly PickerOption[] };

export type PickerChoices = readonly PickerOption[] | readonly PickerGroup[];

/** The blank row's copy. Present only where blank is an answer rather than an absence. */
export type PickerBlank = { label: string };

function isGrouped(choices: PickerChoices): choices is readonly PickerGroup[] {
  return choices.length > 0 && "options" in choices[0];
}

function flatten(choices: PickerChoices): readonly PickerOption[] {
  return isGrouped(choices) ? choices.flatMap((group) => group.options) : choices;
}

/** Case-insensitive match on everything the row shows, so a visible match is never filtered out. */
function matches(option: PickerOption, needle: string): boolean {
  const trimmed = needle.trim().toLowerCase();
  if (trimmed === "") return true;
  return [option.code, option.label, option.hint].some((part) =>
    (part ?? "").toLowerCase().includes(trimmed)
  );
}

/** What a native `<option>` shows, where it cannot style the ID separately. */
function flatLabel(option: PickerOption): string {
  return option.code ? `${option.code} · ${option.label}` : option.label;
}

/** One row's copy, wherever it appears — in the list, on the confirmation line, or as text. */
function Face({ option }: { option: PickerOption }) {
  return (
    <>
      {option.code ? (
        <>
          <span className="bid">{option.code}</span>{" "}
        </>
      ) : null}
      {option.label}
      {option.hint ? <span className="muted combo-hint">{option.hint}</span> : null}
    </>
  );
}

/** ARIA attributes a caller spreads on with `fieldProps`, forwarded verbatim to the input. */
type PassedAria = {
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  "aria-required"?: boolean | "true" | "false";
};

type SharedProps = PassedAria & {
  /** The list, when it is already in the browser. Mutually exclusive with `search`. */
  options?: PickerChoices;
  /** The list, when it is not. Always takes the combobox path — see the note above. */
  search?: (needle: string) => Promise<readonly PickerOption[]>;
  /** Blank as a real answer. Omit on a required field and blank becomes unreachable. */
  blank?: PickerBlank;
  /** Shown when nothing is chosen, and as plain text while `disabled`. */
  placeholder?: string;
  disabled?: boolean;
  /** Dimmed while something the choice triggered is in flight. */
  busy?: boolean;
  autoFocus?: boolean;
};

/* ------------------------------------------------------------------ native, below the cap */

function NativeSelect({
  id,
  name,
  value,
  onPick,
  choices,
  blank,
  placeholder,
  disabled,
  busy,
  className,
  ariaLabel,
  autoFocus,
  aria
}: {
  id?: string;
  name?: string;
  value: string;
  onPick: (next: string) => void;
  choices: PickerChoices;
  blank?: PickerBlank;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  aria: PassedAria;
}) {
  const row = (option: PickerOption) => (
    <option key={option.value} value={option.value}>
      {flatLabel(option)}
    </option>
  );

  return (
    <select
      id={id}
      name={name}
      className={className}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      data-busy={busy ? "" : undefined}
      onChange={(event) => onPick(event.target.value)}
      {...aria}
    >
      {/* A placeholder is `disabled` and blank is not: one is a prompt the reader must
          replace, the other is an answer they may choose. Rendering them identically is how a
          nullable field starts looking required. */}
      {blank ? (
        <option value="">{blank.label}</option>
      ) : placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {isGrouped(choices)
        ? choices.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map(row)}
            </optgroup>
          ))
        : choices.map(row)}
    </select>
  );
}

/* ------------------------------------------------------------------ combobox, above the cap */

function Combo({
  id,
  value,
  onPick,
  options,
  search,
  blank,
  placeholder,
  disabled,
  busy,
  ariaLabel,
  autoFocus,
  aria
}: {
  id?: string;
  value: string;
  onPick: (next: string) => void;
  options?: PickerChoices;
  search?: (needle: string) => Promise<readonly PickerOption[]>;
  blank?: PickerBlank;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
  aria: PassedAria;
}) {
  const listId = useId();
  const [needle, setNeedle] = useState("");
  /** Rows from `search`; unused on the `options` path, which filters what it already has. */
  const [fetched, setFetched] = useState<readonly PickerOption[]>([]);
  const [active, setActive] = useState(0);
  /**
   * Whether the listbox is on screen. Taking an option closes it and shows the confirmation
   * line instead; typing reopens. Separate from `needle` and from `value` because all three
   * move independently — that separation is what keeps a cleared box from clearing the answer.
   */
  const [browsing, setBrowsing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Which needle the newest request was for. A slower earlier query must not overwrite a
   * faster later one — server actions are not ordered, and the visible failure is the list
   * flicking back to results for a prefix the box no longer holds.
   */
  const latest = useRef("");

  const run = (next: string) => {
    if (!search) return;
    latest.current = next;
    startTransition(async () => {
      const rows = await search(next);
      if (latest.current !== next) return;
      setFetched(rows);
      setActive(0);
    });
  };

  // The first page, before anything is typed: this control exists for someone who cannot yet
  // name what they are looking for, and an empty list gives them nothing to start from. The
  // list is only SHOWN once they are browsing, so this is a prefetch, not an open popover.
  useEffect(() => {
    if (search) run("");
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups: readonly PickerGroup[] = useMemo(() => {
    if (search) return [{ label: "", options: fetched }];
    const choices = options ?? [];
    const source = isGrouped(choices) ? choices : [{ label: "", options: choices }];
    return (
      source
        .map((group) => ({ label: group.label, options: group.options.filter((o) => matches(o, needle)) }))
        // A group emptied by the needle is not a group; its heading would read as a section
        // whose rows failed to render.
        .filter((group) => group.options.length > 0)
    );
  }, [search, fetched, options, needle]);

  /** Arrow-key order. The blank row is index 0 where it exists, so it is reachable by keyboard. */
  const navigable = useMemo(() => {
    const rows = groups.flatMap((group) => group.options);
    return blank ? [{ value: "", label: blank.label }, ...rows] : rows;
  }, [groups, blank]);

  /*
   * What the field currently answers, for the confirmation line. Blank resolves to the blank
   * row rather than to null wherever the caller offers one: on a nullable field "" is the
   * answer "No defect", and leaving it to fall through to the placeholder would show a
   * deliberate choice as an unanswered question.
   */
  const chosen = useMemo(() => {
    if (value === "") return blank ? { value: "", label: blank.label } : null;
    const all = search ? fetched : flatten(options ?? []);
    return all.find((option) => option.value === value) ?? null;
  }, [value, blank, search, fetched, options]);

  /* Whether the listbox is RENDERED — the single source for the ARIA below and the render.
     Announcing an expanded combobox whose active descendant is not in the document leaves a
     screen reader describing a control that is no longer there. */
  const listOpen = browsing && navigable.length > 0;

  const take = (option: PickerOption) => {
    onPick(option.value);
    setBrowsing(false);
    // The blank row's label too: taking "No defect" leaves the box reading "No defect", which
    // is what was chosen. Leaving it empty would read as having answered nothing.
    setNeedle(option.label);
    // Move `active` onto what was actually taken. Without this a POINTER choice left the
    // keyboard's cursor wherever the last search put it (index 0), so a subsequent Enter
    // re-took the first row — silently swapping the answer for an unrelated one.
    const index = navigable.findIndex((row) => row.value === option.value);
    if (index >= 0) setActive(index);
  };

  const schedule = (next: string) => {
    setNeedle(next);
    // Typing is the start of a different choice, so the list comes back. The VALUE stays:
    // only taking a row moves it.
    setBrowsing(true);
    if (!search) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(next), DEBOUNCE_MS);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && needle !== "") {
      // Back to browsing the whole list — NOT back to no answer. Emptying the box is how
      // someone searches again; releasing a choice is what the blank row is for.
      event.preventDefault();
      schedule("");
      return;
    }
    // Once something is taken the listbox is gone, so the keys below have nothing to act on and
    // Enter belongs to the form again. Swallowing it here made the picker a dead end: the only
    // way to submit was to reach for the mouse.
    if (!listOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % navigable.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + navigable.length) % navigable.length);
    } else if (event.key === "Enter") {
      // The picker owns Enter while a list is open, or implicit submission would post the form
      // from a keystroke that meant "take this one".
      event.preventDefault();
      take(navigable[active]);
    }
  };

  /* Disabled is two different situations wearing one prop: a form mid-submit, which may
     already hold an answer, and a chained field whose parent is unchosen, which cannot. Stating
     whichever is true beats a dimmed box that invites typing into a control that has nothing to
     answer with. */
  if (disabled) {
    return (
      <p className="combo-disabled" id={id}>
        {chosen ? <Face option={chosen} /> : (placeholder ?? "")}
      </p>
    );
  }

  let index = blank ? 1 : 0;

  return (
    <>
      <div className="list-toolbar combo-box" data-busy={isPending || busy ? "" : undefined}>
        <Search size={14} aria-hidden />
        <input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-activedescendant={listOpen ? `${listId}-${active}` : undefined}
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={needle}
          autoFocus={autoFocus}
          onChange={(event) => schedule(event.target.value)}
          onFocus={() => setBrowsing(true)}
          onKeyDown={onKeyDown}
          {...aria}
        />
      </div>

      {listOpen ? (
        <ul className="combo-list" id={listId} role="listbox" aria-label={ariaLabel}>
          {/* Pinned, and pinned even when the needle matches nothing: "No defect" has to stay
              reachable exactly when someone is typing to find their way out of a wrong pick. */}
          {blank ? (
            <li
              id={`${listId}-0`}
              role="option"
              aria-selected={active === 0}
              data-active={active === 0 ? "" : undefined}
            >
              <button type="button" tabIndex={-1} onClick={() => take({ value: "", label: blank.label })}>
                {blank.label}
              </button>
            </li>
          ) : null}
          {/* `presentation` on the wrapper and on the inner list, so the options stay direct
              children of the listbox (or of the group) in the accessibility tree — a plain
              `<li>` in between makes them list items inside a listbox, which is not a shape
              assistive tech knows how to read. The visible heading is `aria-hidden` because the
              group's own label already carries it. */}
          {groups.map((group) => (
            <li
              key={group.label || "all"}
              className="combo-group"
              role={group.label ? "group" : "presentation"}
              aria-label={group.label || undefined}
            >
              {group.label ? (
                <p className="combo-group-label" aria-hidden>
                  {group.label}
                </p>
              ) : null}
              <ul role="presentation">
                {group.options.map((option) => {
                  const at = index++;
                  return (
                    <li
                      key={option.value}
                      id={`${listId}-${at}`}
                      role="option"
                      aria-selected={at === active}
                      data-active={at === active ? "" : undefined}
                    >
                      {/* A real button: this is a choice being made, and it has to be operable
                          by pointer as well as by the arrow keys above. `tabIndex={-1}` because
                          the input keeps the focus — forty options would otherwise be forty tab
                          stops before the submit. */}
                      <button type="button" tabIndex={-1} onClick={() => take(option)}>
                        <Face option={option} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : browsing ? (
        <p className="combo-empty muted">{isPending ? "Searching…" : `Nothing matches “${needle}”.`}</p>
      ) : chosen ? (
        <p className="combo-chosen">
          <Check size={13} aria-hidden />
          <Face option={chosen} />
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ the form field */

/**
 * A record-backed form field.
 *
 * Uncontrolled by default and controlled the moment `value` is passed. The design brief said
 * `value`/`onChange` and nothing else, but eleven of the seventeen fields being converted post
 * their answer without ever reading it — requiring `value` would add a `useState` to each for
 * no reader's benefit. A chained field passes `value` and keeps owning its own reset.
 */
export function Picker({
  label,
  name,
  value,
  defaultValue = "",
  onChange,
  options,
  search,
  blank,
  placeholder = "Choose…",
  disabled = false,
  busy = false,
  autoFocus = false,
  ...aria
}: SharedProps & {
  label: string;
  /** Posted under this name — as the `<select>` itself, or as a hidden input beside the box. */
  name: string;
  /** Pass to control the field; omit and the picker keeps its own answer. */
  value?: string;
  defaultValue?: string;
  onChange?: (next: string) => void;
}) {
  const inputId = useId();
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;

  const pick = (next: string) => {
    if (value === undefined) setOwn(next);
    onChange?.(next);
  };

  const choices = options ?? [];
  const asCombo = search !== undefined || flatten(choices).length > NEEDLE_THRESHOLD;

  return (
    <div
      className="field combo"
      data-bad={aria["aria-invalid"] ? "" : undefined}
      data-shape={asCombo ? "combo" : "select"}
    >
      {/* The label is a sibling of the control rather than its wrapper: above the threshold the
          control is an input with a listbox of buttons beside it, and interactive elements
          nested inside a `<label>` are neither reliably reachable nor announced as
          themselves. */}
      <label htmlFor={inputId}>
        <span>{label}</span>
      </label>
      {asCombo ? (
        <>
          {/* What the form actually posts. Empty until something is taken, so a submitted-but-
              unchosen form is refused by the domain rather than silently filed against whatever
              happened to be first in the list. */}
          <input type="hidden" name={name} value={current} />
          <Combo
            id={inputId}
            value={current}
            onPick={pick}
            options={options}
            search={search}
            blank={blank}
            placeholder={placeholder}
            disabled={disabled}
            busy={busy}
            autoFocus={autoFocus}
            aria={aria}
          />
        </>
      ) : (
        <NativeSelect
          id={inputId}
          name={name}
          value={current}
          onPick={pick}
          choices={choices}
          blank={blank}
          placeholder={placeholder}
          disabled={disabled}
          busy={busy}
          autoFocus={autoFocus}
          aria={aria}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the list filter */

/**
 * The same control bound to the query string, for filtering a list the server pages — the
 * successor to `UrlSelectFilter`, which it will replace call site by call site. Its "All
 * products" is a real value rather than a prompt, so it arrives as `blank`.
 *
 * `router.replace` and no debounce on the choice itself: unlike typing, taking an option is one
 * deliberate act, so it commits immediately and does not deserve a history entry.
 */
export function UrlPicker({
  options,
  search,
  label,
  allLabel,
  paramKey,
  pageKey = "page"
}: {
  options?: PickerChoices;
  search?: (needle: string) => Promise<readonly PickerOption[]>;
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

  const choices = options ?? [];
  const asCombo = search !== undefined || flatten(choices).length > NEEDLE_THRESHOLD;

  return asCombo ? (
    <div className="combo combo-filter" data-shape="combo">
      <Combo
        value={value}
        onPick={commit}
        options={options}
        search={search}
        blank={{ label: allLabel }}
        placeholder={allLabel}
        busy={isPending}
        ariaLabel={label}
        aria={{}}
      />
    </div>
  ) : (
    <NativeSelect
      value={value}
      onPick={commit}
      choices={choices}
      blank={{ label: allLabel }}
      busy={isPending}
      className="select-filter"
      ariaLabel={label}
      aria={{}}
    />
  );
}
