# QAMS Design System

**Updated:** 2026-08-01 · **Lives in:** `src/app/globals.css` (tokens + primitives), `src/ui/*` (components)
**Status:** the implemented system, documented — not a proposal. Outside `docs/` deliberately: visual
treatment is not QA policy (`docs/architecture.md` § "Web interface" records the policy-level UI
decisions; this file records the craft).

## Principles

1. **Semantic color is the loudest channel.** Pass/Fail/Blocked and severity do real work on every
   screen, so the brand accent stays quiet and neutrals are biased cool toward it. Nothing else may
   use the status colors.
2. **State is never color alone.** Every status ships as a chip: word + stripe + wash. Charts carry
   identity in row labels and chips; fills are reinforcement.
3. **The domain is the gate; the UI is a courtesy.** Hiding/disabling in the UI is presentation.
   Every warning a screen shows ("finalizing can't be undone") precedes a rule the domain enforces.
4. **Nothing is graded that policy doesn't grade.** Dashboards report numbers with their stated
   filters/numerator/denominator/as-of; no red/green judgement exists anywhere
   (`business-rules-and-validation.md:37-38`).
5. **Words come from the docs.** Lifecycle labels use the exact spelling in `roles-workflows.md`
   ("In Review", not "In review").

## Tokens (`:root` in globals.css)

| Group | Tokens | Notes |
|---|---|---|
| Surfaces | `--paper`, `--surface`, `--surface-2` | page, card, inset |
| Lines | `--line`, `--line-soft` | borders, row separators |
| Ink | `--ink`, `--ink-2`, `--ink-3` | primary / secondary / muted text |
| Accent | `--accent`, `--accent-2`, `--accent-wash`, `--on-accent` | brand; wash = hover/active fields |
| Status | `--pass`, `--fail`, `--blocked` + `-wash` each | **reserved**: lifecycle results, severity emphasis, danger buttons |
| Status ink | `--on-status` | text placed on a status-colored fill (danger buttons, badges); dark mode flips it to dark ink because the dark status colors are light |
| Radius | `--radius` 10px, `--radius-ctl` 8px, `--radius-sm` 6px | containers / controls / chips |
| Elevation | `--elev-1` resting, `--elev-2` raised | interactive surfaces move one step on hover |
| Motion | `--ease` = 200ms cubic-bezier(0.4,0,0.2,1) | the one motion voice; killed by prefers-reduced-motion |
| Spacing | `--sp-1..7` = 4/8/12/16/24/32/48 | 4/8-point grid |
| Type | `--sans`, `--mono` | mono is reserved for business IDs and references |

**Dark mode** applies two ways and must agree: `@media (prefers-color-scheme: dark)` (unless the
user chose light) and `:root[data-theme=…]` (the in-app toggle, persisted per browser). Any new
token must be defined in all three blocks. The two dark blocks are wrapped in
`DARK-TOKENS-START/END` markers and `src/app/globals.dark-sync.test.ts` fails the build if they
ever disagree.

## Typography

| Role | Spec |
|---|---|
| h1 | 26/640, -0.014em tracking, balanced wrap |
| h2 | 19/640 · h3 15/640 |
| Body | 15px/1.55, max 68ch |
| Field label | 13/620 ink-2 · Hint 12.5 ink-3 |
| Chip / button | 13/600 · 14/600 |
| KPI value | 30/660 tabular-nums |
| Business ID | `--mono` 0.92em (`.bid`) — people compare these character by character |

## Components

| Primitive | Class(es) | Rules |
|---|---|---|
| Buttons | `.btn`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-sm` | one radius (`--radius-ctl`); hover = elevation, active = 1px press; loading = disabled + verb ("Saving…"); danger only for destructive commits (retire, deactivate); `.btn-sm` for row-level actions |
| Icon button | `.icon-btn` | icon-only control outside the rail (modal close, toast dismiss); always carries `aria-label`; `.rail-icon-btn` stays rail-only |
| Layout utilities | `.row`, `.cluster`, `.stack`, `.page-head`, `.row-main`, `.row-title`, `.card-flush`, `.sr-only` | the recurring compositions, named once — pages must not re-declare these as inline styles; `.page-head` is the one page-header pattern (h1 grows, actions on the baseline) |
| Form grids | `.form-grid-2`, `.form-grid-4`, `.detail-cols`, `.steps-row` | field grids collapse 4→2→1 at 900/560px; `.detail-cols` stacks under 900px; `.steps-row` aligns the steps editor on the inputs' bottom edge (no pixel offsets in JSX) |
| Card | `.card` | container radius, `--elev-1`; `padding: 0` variant hosts row lists |
| Record row | `.list-row` | hover wash, soft separator, wraps on narrow screens |
| List filter | `FilterToolbar` (`src/ui/toolbar.tsx`), `.list-toolbar` | the one filter toolbar; appears only when a list exceeds 5 rows; Escape clears; filtering is presentation — the server decides what exists |
| Stepper | `Stepper` (`src/ui/stepper.tsx`), `.stepper` | ordered list of lifecycle stages; current step carries `aria-current="step"`, done steps carry sr-only "(complete)" — never color alone |
| Data table | `.data-table` in a `.table-scroll` | for homogeneous ≥3-column data people scan and compare (import report); record rows with a story stay `.list-row`. Sortable headers are real buttons with `aria-sort`; long tables reveal in pages of 50, client-side only |
| Chips | `.state` + tone classes | word + stripe + wash; survives greyscale; `.state-accent` is the informational tone for non-lifecycle statuses (import outcomes, "Active") — the Pass/Fail/Blocked tones stay reserved for what policy grades |
| Notice | `.notice`, `.notice-advisory` | failures red; POLICY_NOT_DEFINED and successes calm; `FormNotice` renders both |
| Inline warning | `.why` | a blocked or irreversible action carries its reason inline, never in a tooltip |
| Form section | `.form-section` fieldset | long forms group into named steps |
| Fields | `.field`, `.field-bad` | focus ring = accent wash 3px; error = red border + copy naming the field |
| KPI tile | `.kpi` | label / tabular value / hint |
| Bars | `.bar-row/-head/-track/-fill/-count` | 10px marks, 4px rounded data end, labels in ink tokens, identity never fill-alone |
| Skeleton | `.skeleton` | shape-of-the-page loading; sweep animation |
| Breadcrumbs | `.crumbs` (`Breadcrumbs`) | detail screens only; current record is text with `aria-current` |
| Empty state | `.empty` | one calm sentence + the action that fills it |
| Sidebar | `.rail*`, `.nav-link`, `.nav-badge` | see `src/ui/sidebar.tsx`; badges are domain read models |
| Modal | `Modal` (`src/ui/modal.tsx`), `.modal*` | native `<dialog>` (focus trap, Escape, inert page, focus return are the platform's); sizes sm/md/lg; sticky head/foot, scrollable body; full-sheet under 560px; backdrop click closes only when `closeOnBackdrop` (entry forms: no — typed input outlives a stray click) |
| Confirm dialog | `ConfirmDialog` | warning icon + consequence + the named record + Cancel; the committing control is a caller-supplied server-action form. Used where one click removes availability (deactivate person, deactivate value). A confirm may stack over an open edit modal: both live in the native top layer, which gives focus and Escape to the topmost and returns them outward — allowed, and nothing else may stack deeper |
| Toast | `ToastProvider`/`useToast` (`src/ui/toast.tsx`), `.toast*` | SUCCESSES ONLY — fires when a modal closes itself and takes its inline notice with it. Failures always stay inline (`FormNotice`) naming the field. Polite live region, 4s auto-dismiss that pauses on hover/focus, an explicit dismiss button, no other actions |

**Modal vs. page rule:** a create/edit flow lives in a modal when the hosting screen already
has everything the form needs (catalogue add/edit, add person, edit person, add value); it stays
a page when the form is long enough to have sections (new test case) or needs its own reference
data fetch (new defect, plan execution). Detail-screen lifecycle actions (approve, retire,
transition, reassign, finalize) stay inline on the record — they are the record's story, not a
data-entry interruption.

Component modules: `sidebar.tsx`, `case-table.tsx`, `record-list.tsx`, `chips.tsx`, `notice.tsx`,
`breadcrumbs.tsx`, `toolbar.tsx` (FilterToolbar), `stepper.tsx`, `modal.tsx`, `toast.tsx`,
`form.ts` (field-error accessibility helpers), `action.ts` (FormState contract),
`navigation.ts` (the ratified screen inventory).

**Inline styles:** a page may inline a style only when it is data-driven (a bar's `width: pct%`)
or a genuine single-property one-off (an odd margin). Recurring compositions — headers, rows,
identity lines, grids — must use the layout utilities above; re-declaring them inline is drift.

## Icons

`lucide-react`, 15–17px, `strokeWidth` ~1.9, always `aria-hidden` with adjacent text carrying the
meaning. Icon-per-screen map lives in `sidebar.tsx`, keyed by href so `navigation.ts` stays pure.

## Interaction rules

- Transitions: 200ms, one curve, on background/border/shadow/width — never on layout-shifting
  properties except the rail width. `prefers-reduced-motion` collapses everything.
- Every mutation renders its outcome inline via `FormNotice` — failures name the field
  (`.field-bad`), internal errors show a log-correlatable reference, successes are calm.
- Destructive/irreversible actions state consequences in a `.why` before the button, and the
  button is `.btn-danger` when the action removes availability (retire, deactivate).
- Keyboard: skip-link to `#main`, `:focus-visible` rings everywhere, search fields clear on Escape,
  `aria-expanded`/`aria-current` carry widget state.

## Accessibility checklist for new screens

1. Page starts at `h1`; sections use `h2` in order.
2. Every input inside a `label.field`; errors set `.field-bad` *and* name the field in copy.
3. A failed field also carries `aria-invalid` and `aria-describedby` pointing at the form's
   `FormNotice` — use `fieldClass`/`fieldProps`/`noticeId` from `src/ui/form.ts` with a
   module-level `FORM_ID` slug, so the association survives refactors.
4. Fields are required by default; the exceptions say so — append "(optional)" to the label of
   any control without `required`. Never mark conditionally-required fields optional (e.g. the
   block reason, the finalize-defect fieldset) — their copy explains the condition instead.
5. State chips, never bare color; icons `aria-hidden` beside text.
6. Lists reachable and operable by keyboard only; row actions are real links/buttons.
7. Works in both themes (check the toggle, not just OS preference).
8. Charts: identity via label/chip; the metric statement renders with the numbers, and a
   `.sr-only` sentence summarizes the series for readers who don't get the bars.
9. Anything that disappears on its own can be paused: toasts pause on hover/focus and carry a
   dismiss button.
